import AppKit
import CoreServices
import VocifyCore

/// Reads the CRM pages open in the rep's browsers (see `CrmPages`).
///
/// Only browsers that are already running are asked, so nothing is ever
/// launched. Each browser needs the rep's one-time Automation consent
/// ("Vocify wants to control Google Chrome").
@MainActor
enum CrmPageReader {
    enum Access: String {
        case granted
        case denied
        /// Consent not given yet and `ask` was false.
        case notAsked = "not_asked"
        case unavailable
    }

    static let automationSettingsURL = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
    )!

    /// `{ urls: [String], browsers: [{ name, bundleId, access }] }`
    static func read(ask: Bool) async -> [String: Any] {
        let running = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
        let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        var urls: [String] = []
        var browsers: [[String: String]] = []
        for browser in CrmPages.browsersToRead(running: running, frontmost: frontmost) {
            let bundleID = browser.bundleID
            let access = await Task.detached { determineAccess(bundleID: bundleID, ask: ask) }.value
            browsers.append(["name": browser.name, "bundleId": bundleID, "access": access.rawValue])
            if access == .granted, let output = run(browser.script) {
                urls.append(contentsOf: CrmPages.crmURLs(fromScriptOutput: output))
            }
        }
        return ["urls": urls, "browsers": browsers]
    }

    /// Blocks while macOS shows the consent prompt, so never call it on the main thread.
    nonisolated private static func determineAccess(bundleID: String, ask: Bool) -> Access {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleID)
        guard let desc = target.aeDesc else { return .unavailable }
        let status = AEDeterminePermissionToAutomateTarget(desc, typeWildCard, typeWildCard, ask)
        switch status {
        case noErr: return .granted
        case OSStatus(errAEEventNotPermitted): return .denied
        case OSStatus(errAEEventWouldRequireUserConsent): return .notAsked
        default: return .unavailable
        }
    }

    private static func run(_ source: String) -> String? {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
            fputs("CrmPageReader: \(error)\n", stderr)
            return nil
        }
        return result?.stringValue
    }
}
