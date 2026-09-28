import Foundation
import ScreenCaptureKit

/// ScreenCaptureKit audio uses the Screen & System Audio Recording TCC service on macOS 15.
enum SystemAudioPermission {
    struct Probe: Sendable {
        let status: String
        let preflight: Bool
        let lastError: String?
    }

    /// Read-only status for UI polling. Never starts SCStream.
    static func status() async -> String {
        await probe().status
    }

    static func probe() async -> Probe {
        let preflight = CGPreflightScreenCaptureAccess()
        if preflight { return Probe(status: "authorized", preflight: true, lastError: nil) }

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            if content.displays.first != nil {
                return Probe(status: "authorized", preflight: false, lastError: nil)
            }
            return Probe(status: "never_requested", preflight: false, lastError: "no displays")
        } catch let error as NSError {
            return Probe(status: classify(error), preflight: false, lastError: error.localizedDescription)
        }
    }

    /// Registers with TCC and may show the system consent sheet (not Settings).
    static func requestSystemPrompt() -> Bool {
        CGRequestScreenCaptureAccess()
    }

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
