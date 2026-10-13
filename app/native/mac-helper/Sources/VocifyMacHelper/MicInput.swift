import AVFoundation
import Foundation

/// The default microphone on its own, as 16 kHz mono PCM16 (`vocify-mac-helper microphone`, a process next to `audio`).
/// Like anarlog (its own mic stream next to the system-audio tap), not through the tap's device: built into that device
/// the microphone stopped the device from running inside the app and disturbed the page's mic too (2026-10-14). The two
/// run on different clocks; the server measures how far apart they are and lines them up.
final class MicInput: @unchecked Sendable {
    /// Each piece of microphone audio, on the engine's own thread.
    var onSamples: (([Int16]) -> Void)?

    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
    private var mono: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var observer: NSObjectProtocol?
    private var running = false
    /// Opened and closed from different threads (the capture's start and stop, a device change): one at a time.
    private let lock = NSRecursiveLock()

    /// False when the microphone cannot be opened (no input device, no permission): the call goes on without it.
    func start() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !running else { return true }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: format.sampleRate, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: mono, to: target) else { return false }
        self.mono = mono
        self.converter = converter
        // ~100 ms per buffer at the device's rate.
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(format.sampleRate / 10), format: format) { [weak self] buffer, _ in
            self?.receive(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            return false
        }
        running = true
        // A new default microphone (AirPods connected, another input chosen): the engine stops, so it starts again on it.
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.stop()
            if !self.start() { status(["event": "mic", "state": "lost"]) }
        }
        return true
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        guard running else { return }
        running = false
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
    }

    private func receive(_ buffer: AVAudioPCMBuffer) {
        guard let mono, let converter, buffer.frameLength > 0, let source = buffer.floatChannelData?[0],
              let first = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: buffer.frameLength),
              let dst = first.floatChannelData?[0] else { return }
        // The first channel: a mic's channels are the same voice.
        dst.update(from: source, count: Int(buffer.frameLength))
        first.frameLength = buffer.frameLength
        let capacity = AVAudioFrameCount(Double(first.frameLength) * target.sampleRate / mono.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        // One converter for the whole capture, so resampling carries over from buffer to buffer.
        converter.convert(to: out, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return first
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }
        onSamples?(Array(UnsafeBufferPointer(start: samples, count: Int(out.frameLength))))
    }
}
