import CoreAudio
import Darwin
import Foundation

/// System audio capture using Core Audio process tap (macOS 14.2+)
///
/// Full implementation requires:
/// 1. Creating a process tap with AudioHardwareCreateProcessTap
/// 2. Excluding the helper's own process and descendants
/// 3. Setting up an IOProc callback to handle audio buffers
/// 4. Converting audio to mono 16 kHz s16le PCM
/// 5. Streaming PCM data to stdout with JSON status to stderr
public class AudioCapture {

    public init() {}

    /// Start capturing system audio, excluding the Vocify app's own processes
    /// Outputs raw PCM (mono, 16 kHz, s16le) to stdout
    public func startCapture() throws -> String {
        guard #available(macOS 14.2, *) else {
            return "error: unsupported OS version (requires macOS 14.2+)"
        }

        // Full implementation pending - requires Core Audio process tap setup
        // See PROTOCOL.md for output specification
        return "error: audio capture not yet implemented"
    }

    /// Stop capturing audio
    public func stopCapture() {
        // Clean up any active capture
    }
}

public struct AudioError: LocalizedError {
    let code: String

    public var errorDescription: String? {
        "Audio error: \(code)"
    }
}
