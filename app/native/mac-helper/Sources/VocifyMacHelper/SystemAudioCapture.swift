import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

/// `vocify-mac-helper audio`: the call's audio through ScreenCaptureKit, the same capture as the Swift app's
/// MeetingCapture (apps/macos/Sources/VocifyCompanion/MeetingCapture.swift), so it needs the same permission
/// (Screen & System Audio Recording) and keeps the same recovery: a change of audio output, or a stream gone quiet,
/// restarts it. PCM (mono 16 kHz s16le) goes to stdout, status lines to stderr (see PROTOCOL.md).
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "vocify.helper.system-audio")
    private var lastSampleAt = Date()
    private var lastWriteAt = Date()
    private var lastRestartAt = Date.distantPast
    private var restarting = false
    private var started = false
    private var timer: DispatchSourceTimer?
    private var outputListener: AudioObjectPropertyListenerBlock?
    /// Called once when capture cannot go on; the helper then exits.
    var onEnd: ((_ event: String, _ reason: String) -> Void)?

    private static let quietBeforeRestart: TimeInterval = 10
    private static let minimumBetweenRestarts: TimeInterval = 30
    /// 100 ms of silence: written when nothing arrived for a while, so a quiet Mac still sends audio.
    private static let silence = Data(count: 3200)

    func start() {
        Task {
            if await open() {
                queue.async {
                    self.started = true
                    self.lastSampleAt = Date()
                    self.lastWriteAt = Date()
                    status(["event": "started"])
                    self.watch()
                }
            } else {
                let reason = CGPreflightScreenCaptureAccess() ? "capture_failed" : "permission_denied"
                onEnd?("error", reason)
            }
        }
    }

    func stop() {
        stopWatching()
        let active = stream
        stream = nil
        let done = DispatchSemaphore(value: 0)
        Task {
            if let active { try? await active.stopCapture() }
            done.signal()
        }
        _ = done.wait(timeout: .now() + 2)
    }

    /// The whole display's audio, minus Vocify's own (the app that started this helper) and this helper's.
    private func open() async -> Bool {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { return false }
            let parent = getppid()
            let vocify = content.applications.filter { $0.processID == parent }
            let filter = SCContentFilter(display: display, excludingApplications: vocify, exceptingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16000
            config.channelCount = 1
            config.width = 2
            config.height = 2
            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            try await stream.startCapture()
            self.stream = stream
            return true
        } catch {
            stream = nil
            return false
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard stream === self.stream else { return }
            self.stream = nil
            self.restart(force: true) { recovered in
                if !recovered { self.onEnd?("lost", "stream_stopped") }
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let pcm = Self.pcm(from: sampleBuffer) else { return }
        lastSampleAt = Date()
        write(pcm)
    }

    private func write(_ data: Data) {
        lastWriteAt = Date()
        FileHandle.standardOutput.write(data)
    }

    // MARK: Keeping it alive (as MeetingCapture does)

    private func watch() {
        var address = Self.defaultOutputAddress
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.restart(force: true)
        }
        if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, listener) == noErr {
            outputListener = listener
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        timer.setEventHandler { [weak self] in
            guard let self, self.started else { return }
            let now = Date()
            if now.timeIntervalSince(self.lastWriteAt) > 0.3 { self.write(Self.silence) }
            if now.timeIntervalSince(self.lastSampleAt) > Self.quietBeforeRestart { self.restart(force: false) }
        }
        timer.resume()
        self.timer = timer
    }

    private func stopWatching() {
        timer?.cancel()
        timer = nil
        if let listener = outputListener {
            var address = Self.defaultOutputAddress
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, listener)
            outputListener = nil
        }
    }

    /// `force`: a device change or an error, restart now; otherwise at most once per `minimumBetweenRestarts`.
    /// Runs on `queue`.
    private func restart(force: Bool, completion: ((Bool) -> Void)? = nil) {
        let now = Date()
        guard !restarting, force || now.timeIntervalSince(lastRestartAt) > Self.minimumBetweenRestarts else {
            completion?(stream != nil)
            return
        }
        restarting = true
        lastRestartAt = now
        lastSampleAt = now
        let old = stream
        stream = nil
        Task {
            if let old { try? await old.stopCapture() }
            let reopened = await self.open()
            self.queue.async {
                self.restarting = false
                completion?(reopened)
            }
        }
    }

    private static var defaultOutputAddress: AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func pcm(from sampleBuffer: CMSampleBuffer) -> Data? {
        guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              let format = AVAudioFormat(streamDescription: asbd) else { return nil }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        let copied = CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList)
        guard copied == noErr else { return nil }
        return int16(from: buffer)
    }

    /// Mono 16 kHz signed 16-bit, as the Swift app's PCMEncode.int16.
    private static func int16(from buffer: AVAudioPCMBuffer) -> Data? {
        guard let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: buffer.format, to: target) else { return nil }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / buffer.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard error == nil, let channel = out.int16ChannelData?[0] else { return nil }
        return Data(bytes: channel, count: Int(out.frameLength) * MemoryLayout<Int16>.size)
    }
}

/// One status line on stderr (PROTOCOL.md).
func status(_ fields: [String: String]) {
    guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardError.write(Data((line + "\n").utf8))
}

/// Screen & System Audio Recording, read without asking (CGPreflightScreenCaptureAccess, as the Swift app does).
/// macOS does not tell "refused" from "never asked" here, so both read as never_requested.
func systemAudioPermission() -> String {
    CGPreflightScreenCaptureAccess() ? "authorized" : "never_requested"
}
