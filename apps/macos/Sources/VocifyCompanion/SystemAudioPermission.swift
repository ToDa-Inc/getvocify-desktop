import Foundation
import ScreenCaptureKit

/// macOS can grant full Screen Recording or System Audio Recording Only (14.4+).
/// `CGPreflightScreenCaptureAccess` only reflects the screen-recording bit, so the
/// real check is whether ScreenCaptureKit can enumerate displays and start audio.
enum SystemAudioPermission {
    static func status() async -> String {
        if await canCaptureSystemAudio() { return "authorized" }

        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            if await canCaptureSystemAudio() { return "authorized" }
            return "never_requested"
        } catch let error as NSError {
            return classify(error)
        }
    }

    /// Starts a tiny audio-only stream; the only reliable end-to-end probe.
    static func canCaptureSystemAudio() async -> Bool {
        let capture = MeetingCapture()
        await capture.startSystemAudio()
        let ok = capture.hasSystemStream
        capture.stop()
        return ok
    }

    private static func classify(_ error: NSError) -> String {
        let msg = error.localizedDescription.lowercased()
        if msg.contains("declined") || msg.contains("denied") || msg.contains("not authorized") {
            return "denied"
        }
        if error.domain == "com.apple.screencapturekit.SCStreamErrorDomain", error.code == -3801 {
            return "denied"
        }
        return "never_requested"
    }
}
