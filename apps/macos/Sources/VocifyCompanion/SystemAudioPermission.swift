import Foundation
import ScreenCaptureKit

/// macOS can grant full Screen Recording or System Audio Recording Only (14.4+).
/// Never start a capture stream just to poll — that flakes and re-triggers prompts.
enum SystemAudioPermission {
    /// Light check for UI polling. Does not allocate SCStream.
    static func status() async -> String {
        if CGPreflightScreenCaptureAccess() { return "authorized" }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard content.displays.first != nil else { return "never_requested" }
            return "authorized"
        } catch let error as NSError {
            return classify(error)
        }
    }

    /// End-to-end probe right before recording starts.
    static func captureReady() async -> Bool {
        if await status() != "authorized" { return false }
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
