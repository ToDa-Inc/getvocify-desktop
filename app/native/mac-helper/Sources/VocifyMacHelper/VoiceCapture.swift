import AVFoundation
import Foundation

/// `vocify-mac-helper voice`: the default microphone through Apple's voice-processing unit (AVAudioEngine), converted to
/// 16 kHz mono PCM16 on stdout. Voice processing removes what the device plays from the microphone; on macOS 14+ the
/// ducking it applies to other audio is set to its minimum so the call stays as loud as it was.
final class VoiceCapture: AudioCapture, @unchecked Sendable {
    var onEnd: ((_ event: String, _ reason: String) -> Void)?

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!

    func start() {
        let input = engine.inputNode
        do {
            // Before any format is read: voice processing changes the input's format.
            try input.setVoiceProcessingEnabled(true)
        } catch {
            onEnd?("error", "voice_processing_failed")
            return
        }
        if #available(macOS 14.0, *) {
            input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
                enableAdvancedDucking: false, duckingLevel: .min)
        }
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, let converter = AVAudioConverter(from: format, to: target) else {
            onEnd?("error", "no_microphone")
            return
        }
        converter.downmix = true
        self.converter = converter
        input.installTap(onBus: 0, bufferSize: 1600, format: format) { [weak self] buffer, _ in
            self?.receive(buffer)
        }
        do {
            try engine.start()
        } catch {
            onEnd?("error", "engine_failed")
            return
        }
        status(["event": "started", "rate": String(Int(format.sampleRate)), "channels": String(format.channelCount)])
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private func receive(_ buffer: AVAudioPCMBuffer) {
        guard let converter, buffer.frameLength > 0 else { return }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }
        FileHandle.standardOutput.write(Data(bytes: samples, count: Int(out.frameLength) * MemoryLayout<Int16>.size))
    }
}
