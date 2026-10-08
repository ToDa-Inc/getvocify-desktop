import CoreAudio
import Foundation

/// Pure-logic audio utilities for PCM conversion and format handling
public struct AudioProcessing {
    /// Convert audio to mono 16 kHz s16le
    /// - Parameters:
    ///   - inputSamples: Input audio samples
    ///   - inputFormat: Input audio format description
    ///   - targetSampleRate: Target sample rate (default: 16000)
    ///   - targetChannels: Target channel count (default: 1 for mono)
    /// - Returns: Converted audio data in target format
    public static func convertToTargetFormat(
        inputSamples: [Float],
        inputSampleRate: Int,
        targetSampleRate: Int = 16000,
        targetChannels: Int = 1
    ) -> [Int16] {
        guard targetChannels == 1 else { return [] }

        let ratio = Double(targetSampleRate) / Double(inputSampleRate)
        let outputCount = Int(Double(inputSamples.count) * ratio)
        var output = [Int16]()
        output.reserveCapacity(outputCount)

        for i in 0..<outputCount {
            let inputIndex = Double(i) / ratio
            let sample = linearInterpolate(inputSamples, at: inputIndex)
            output.append(floatToInt16(sample))
        }

        return output
    }

    /// Mix multiple channels to mono
    /// - Parameter samples: Input samples from multiple channels
    /// - Parameter channelCount: Number of channels
    /// - Returns: Mono mixed samples
    public static func mixToMono(samples: [Float], channelCount: Int) -> [Float] {
        guard channelCount > 0 else { return [] }

        let framesPerChannel = samples.count / channelCount
        var output = [Float](repeating: 0, count: framesPerChannel)

        for frame in 0..<framesPerChannel {
            var sum: Float = 0
            for ch in 0..<channelCount {
                sum += samples[frame * channelCount + ch]
            }
            output[frame] = sum / Float(channelCount)
        }

        return output
    }

    // MARK: - Private Helpers

    private static func floatToInt16(_ value: Float) -> Int16 {
        let clamped = max(-1.0, min(1.0, value))
        return Int16(clamped * 32767.0)
    }

    private static func linearInterpolate(_ samples: [Float], at index: Double) -> Float {
        guard !samples.isEmpty else { return 0 }

        let lowerIdx = Int(floor(index))
        let upperIdx = Int(ceil(index))
        let frac = index - Double(lowerIdx)

        guard upperIdx < samples.count else {
            return samples[min(lowerIdx, samples.count - 1)]
        }

        let lower = samples[lowerIdx]
        let upper = samples[upperIdx]
        return lower + Float(frac) * (upper - lower)
    }
}
