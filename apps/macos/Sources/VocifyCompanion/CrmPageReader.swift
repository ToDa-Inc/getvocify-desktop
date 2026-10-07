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

    /// `{ urls: [String], browsers: [{ name, bundleId, access }] }`, and the call or meeting page
    /// on screen. Only CRM URLs leave the Mac; any other page is reduced to the call app it is.
    static func read(ask: Bool) async -> (result: [String: Any], source: CallSource?) {
        let running = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
        let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        var urls: [String] = []
        var pages: [String] = []
        var browsers: [[String: String]] = []
        for browser in CrmPages.browsersToRead(running: running, frontmost: frontmost) {
            let bundleID = browser.bundleID
            let access = await Task.detached { determineAccess(bundleID: bundleID, ask: ask) }.value
            browsers.append(["name": browser.name, "bundleId": bundleID, "access": access.rawValue])
            if access == .granted, let output = run(browser.script) {
                urls.append(contentsOf: CrmPages.crmURLs(fromScriptOutput: output))
                pages.append(contentsOf: output.split(whereSeparator: \.isNewline).map(String.init))
            }
        }
        return (["urls": urls, "browsers": browsers], CallSource.page(in: pages))
    }

    /// The front window's active tab as a CRM URL (or none), when the frontmost app is a supported browser
    /// Vocify may read; nil otherwise.
    /// Never asks for consent (that happens once, from first-run setup), so it never blocks on a prompt.
    /// The front window's active tab as a CRM URL (or none) for a supported browser Vocify may read; nil otherwise.
    /// Runs off the main thread: the consent check and the script take tens of milliseconds, every 1.5 s.
    nonisolated static func readFront(bundleID: String) async -> [String]? {
        guard let browser = CrmPages.browser(bundleID: bundleID) else { return nil }
        return await Task.detached(priority: .utility) {
            guard determineAccess(bundleID: bundleID, ask: false) == .granted,
                  let output = runOsascript(browser.script)
            else { return nil }
            return CrmPages.frontRecordURLs(fromScriptOutput: output)
        }.value
    }

    /// `osascript` in its own process: AppleScript off the main thread, attributed to Vocify (its parent) for consent.
    nonisolated private static func runOsascript(_ source: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", source]
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return nil
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Each running supported browser's Automation consent; `ask` shows macOS's prompt for the ones not asked yet.
    static func access(ask: Bool) async -> [String] {
        let running = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
        var answers: [String] = []
        for browser in CrmPages.browsersToRead(running: running, frontmost: nil) {
            let bundleID = browser.bundleID
            answers.append(await Task.detached { determineAccess(bundleID: bundleID, ask: ask) }.value.rawValue)
        }
        return answers
    }

    /// Blocks while macOS shows the consent prompt, so never call it on the main thread with `ask`.
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
