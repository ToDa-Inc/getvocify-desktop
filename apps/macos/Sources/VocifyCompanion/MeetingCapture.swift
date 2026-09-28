import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

final class MeetingCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    /// Called on the capture queue, never on the main thread.
    var onPCM: ((String, Data) -> Void)?
    var onSystemAudioStopped: (() -> Void)?
    private(set) var hasSystemStream = false
    private let engine = AVAudioEngine()
    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "vocify.system-audio")

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
        onSystemAudioStopped?()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let pcm = Self.pcm(from: sampleBuffer) else { return }
        onPCM?("prospect", pcm)
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
