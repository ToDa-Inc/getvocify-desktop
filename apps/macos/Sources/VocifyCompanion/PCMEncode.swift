import AVFoundation
import Foundation

enum PCMEncode {
    static func int16(from buffer: AVAudioPCMBuffer, targetRate: Double = 16000) -> Data? {
        guard let converted = convert(buffer, rate: targetRate) else { return nil }
        guard let channel = converted.int16ChannelData?[0] else { return nil }
        let count = Int(converted.frameLength)
        return Data(bytes: channel, count: count * MemoryLayout<Int16>.size)
    }

    private static func convert(_ buffer: AVAudioPCMBuffer, rate: Double) -> AVAudioPCMBuffer? {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: rate,
            channels: 1,
            interleaved: false
        ) else { return nil }
        guard let converter = AVAudioConverter(from: buffer.format, to: format) else { return nil }
        let ratio = rate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var consumed = false
        let input: AVAudioConverterInputBlock = { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        var error: NSError?
        converter.convert(to: out, error: &error, withInputFrom: input)
        if error != nil { return nil }
        return out
    }
}
