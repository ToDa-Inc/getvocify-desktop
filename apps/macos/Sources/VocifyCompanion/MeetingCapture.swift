import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Capture state is touched from the system-audio queue and the main actor, as ScreenCaptureKit
/// and CoreAudio call back; restarts serialize through `audioQueue` and the `restarting` flag.
final class MeetingCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    /// Called on the capture queue, never on the main thread.
    var onPCM: ((String, Data) -> Void)?
    var onSystemAudioStopped: (() -> Void)?
    private(set) var hasSystemStream = false
    private let engine = AVAudioEngine()
    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "vocify.system-audio")

    /// The meeting wants the other side's audio until it stops; restarts keep it coming.
    private var wantsSystemAudio = false
    private var lastSampleAt = Date()
    private var lastRestartAt = Date.distantPast
    private var restarting = false
    private var watchdog: DispatchSourceTimer?
    private var outputListener: AudioObjectPropertyListenerBlock?
    /// A switch of the Mac's audio output (phone, AirPods) can silently end the capture.
    private static let quietBeforeRestart: TimeInterval = 10
    private static let minimumBetweenRestarts: TimeInterval = 30

    func start() throws {
        let input = engine.inputNode
        engine.prepare()
        try engine.start()
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let pcm = PCMEncode.int16(from: buffer) else { return }
            self?.onPCM?("rep", pcm)
        }
    }

    func startSystemAudio() async {
        wantsSystemAudio = true
        lastSampleAt = Date()
        watchOutputAndSilence()
        await openSystemStream()
    }

    private func openSystemStream() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { return }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16000
            config.channelCount = 1
            config.width = 2
            config.height = 2
            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
            try await stream.startCapture()
            self.stream = stream
            hasSystemStream = true
        } catch {
            stream = nil
            hasSystemStream = false
        }
    }

    func stopSystemAudioOnly() {
        wantsSystemAudio = false
        stopWatching()
        let active = stream
        stream = nil
        hasSystemStream = false
        if let active {
            Task { try? await active.stopCapture() }
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        stopSystemAudioOnly()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        guard stream === self.stream else { return }
        self.stream = nil
        hasSystemStream = false
        // Try once more before telling the meeting its other side is gone.
        restartSystemAudio(force: true) { [weak self] recovered in
            if !recovered { self?.onSystemAudioStopped?() }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let pcm = Self.pcm(from: sampleBuffer) else { return }
        lastSampleAt = Date()
        onPCM?("prospect", pcm)
    }

    // MARK: Keeping the other side's audio alive

    /// Restarts the capture when the audio output changes, or when it has gone quiet for long
    /// enough that it has most likely stalled. At most once per `minimumBetweenRestarts`.
    private func watchOutputAndSilence() {
        stopWatching()
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.restartSystemAudio(force: true)
        }
        if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, audioQueue, listener) == noErr {
            outputListener = listener
        }
        let timer = DispatchSource.makeTimerSource(queue: audioQueue)
        timer.schedule(deadline: .now() + 2, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self, self.wantsSystemAudio else { return }
            if Date().timeIntervalSince(self.lastSampleAt) > Self.quietBeforeRestart {
                self.restartSystemAudio(force: false)
            }
        }
        timer.resume()
        watchdog = timer
    }

    private func stopWatching() {
        watchdog?.cancel()
        watchdog = nil
        if let listener = outputListener {
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, audioQueue, listener)
            outputListener = nil
        }
    }

    /// `force`: a device change or an error, restart now; otherwise respect the minimum gap.
    private func restartSystemAudio(force: Bool, completion: ((Bool) -> Void)? = nil) {
        let now = Date()
        guard wantsSystemAudio, !restarting,
              force || now.timeIntervalSince(lastRestartAt) > Self.minimumBetweenRestarts else {
            completion?(hasSystemStream)
            return
        }
        restarting = true
        lastRestartAt = now
        lastSampleAt = now
        let old = stream
        stream = nil
        hasSystemStream = false
        Task {
            if let old { try? await old.stopCapture() }
            await self.openSystemStream()
            self.audioQueue.async {
                self.restarting = false
                completion?(self.hasSystemStream)
            }
        }
    }

    private static func pcm(from sampleBuffer: CMSampleBuffer) -> Data? {
        guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return nil }
        guard let format = AVAudioFormat(streamDescription: asbd) else { return nil }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frames),
            into: buffer.mutableAudioBufferList
        )
        guard status == noErr else { return nil }
        return PCMEncode.int16(from: buffer)
    }
}
