import Foundation
import ScreenCaptureKit

/// ScreenCaptureKit audio uses Screen & System Audio Recording TCC on macOS 15+.
enum SystemAudioPermission {
    struct Probe: Sendable {
        let status: String
        let preflight: Bool
        let lastError: String?
    }

    static func status() async -> String {
        probe().status
    }

    /// Read-only. Uses TCC preflight only — no SCStream, no shareable-content probe.
    static func probe() -> Probe {
        let preflight = CGPreflightScreenCaptureAccess()
        if preflight {
            return Probe(status: "authorized", preflight: true, lastError: nil)
        }
        return Probe(status: "never_requested", preflight: false, lastError: nil)
    }

    /// Asks macOS once, then touches ScreenCaptureKit so Vocify is registered in the list (usually off).
    static func register() async {
        if CGPreflightScreenCaptureAccess() { return }
        _ = CGRequestScreenCaptureAccess()
        if CGPreflightScreenCaptureAccess() { return }
        _ = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    }
}
