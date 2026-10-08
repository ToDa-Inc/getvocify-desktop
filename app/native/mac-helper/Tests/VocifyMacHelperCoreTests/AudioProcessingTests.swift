import XCTest
@testable import VocifyMacHelperCore

final class AudioProcessingTests: XCTestCase {

    func testMixToMono_TwoChannels() {
        let stereoSamples: [Float] = [0.5, 0.3, -0.5, 0.7]  // 2 frames, 2 channels
        let mono = AudioProcessing.mixToMono(samples: stereoSamples, channelCount: 2)

        XCTAssertEqual(mono.count, 2)
        XCTAssertAlmostEqual(mono[0], 0.4, accuracy: 0.001)  // (0.5 + 0.3) / 2
        XCTAssertAlmostEqual(mono[1], 0.1, accuracy: 0.001)  // (-0.5 + 0.7) / 2
    }

    func testMixToMono_Empty() {
        let mono = AudioProcessing.mixToMono(samples: [], channelCount: 2)
        XCTAssertEqual(mono.count, 0)
    }

    func testConvertToTargetFormat_Passthrough() {
        let input: [Float] = [0.5, -0.5, 0.25]
        let output = AudioProcessing.convertToTargetFormat(
            inputSamples: input,
            inputSampleRate: 16000,
            targetSampleRate: 16000,
            targetChannels: 1
        )

        XCTAssertEqual(output.count, input.count)
        // Check approximate values (float to int16 conversion)
        XCTAssertAlmostEqual(Float(output[0]) / 32767.0, 0.5, accuracy: 0.01)
        XCTAssertAlmostEqual(Float(output[1]) / 32767.0, -0.5, accuracy: 0.01)
    }

    func testConvertToTargetFormat_Downsample() {
        // Downsample from 48kHz to 16kHz (3:1 ratio)
        let input: [Float] = [Float](repeating: 0.5, count: 48)
        let output = AudioProcessing.convertToTargetFormat(
            inputSamples: input,
            inputSampleRate: 48000,
            targetSampleRate: 16000,
            targetChannels: 1
        )

        XCTAssertEqual(output.count, 16)  // 48 * (16000/48000) = 16
        // All values should be similar since input is constant
        for sample in output {
            XCTAssertAlmostEqual(Float(sample) / 32767.0, 0.5, accuracy: 0.01)
        }
    }
}
