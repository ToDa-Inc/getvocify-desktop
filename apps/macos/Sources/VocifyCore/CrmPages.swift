import Foundation

/// Which CRM pages the rep has open, read from their browsers when a call starts.
///
/// The Mac app asks each running browser for the active tab of every window,
/// front window first (macOS automation). Only HubSpot and Pipedrive app URLs
/// leave the machine; the backend decides which record that is
/// (backend/app/services/live_calls/crm_url.py).
public enum CrmPages {
    public struct Browser: Equatable, Sendable {
        public let name: String
        public let bundleID: String
        /// AppleScript returning one active-tab URL per line, front window first.
        public let script: String
    }

    /// Chromium browsers share Chrome's dictionary; Safari names it "current tab".
    public static let browsers: [Browser] = [
        chromium("Google Chrome", "com.google.Chrome"),
        chromium("Arc", "company.thebrowser.Browser"),
        chromium("Microsoft Edge", "com.microsoft.edgemac"),
        chromium("Brave", "com.brave.Browser"),
        chromium("Chromium", "org.chromium.Chromium"),
        Browser(name: "Safari", bundleID: "com.apple.Safari", script: tabScript("com.apple.Safari", tab: "current tab")),
    ]

    public static func browser(bundleID: String) -> Browser? {
        browsers.first { $0.bundleID == bundleID }
    }

    /// Running supported browsers, the front-most app first, then the order macOS lists them.
    public static func browsersToRead(running: [String], frontmost: String?) -> [Browser] {
        var ordered: [String] = []
        if let frontmost, running.contains(frontmost) { ordered.append(frontmost) }
        for id in running where !ordered.contains(id) { ordered.append(id) }
        return ordered.compactMap(browser(bundleID:))
    }

    /// The CRM URLs in one browser's script output, in window order.
    public static func crmURLs(fromScriptOutput output: String) -> [String] {
        output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter(isCrmURL)
    }

    /// HubSpot or Pipedrive web app pages; everything else stays on the machine.
    public static func isCrmURL(_ url: String) -> Bool {
        guard let components = URLComponents(string: url),
              components.scheme == "https",
              let host = components.host?.lowercased()
        else { return false }
        if host.hasSuffix(".hubspot.com") {
            let sub = host.dropLast(".hubspot.com".count)
            return sub == "app" || (sub.hasPrefix("app-") && !sub.contains("."))
        }
        if host.hasSuffix(".pipedrive.com") {
            let sub = String(host.dropLast(".pipedrive.com".count))
            return !sub.isEmpty && !sub.contains(".") && !["api", "oauth", "www", "developers", "app"].contains(sub)
        }
        return false
    }

    private static func chromium(_ name: String, _ bundleID: String) -> Browser {
        Browser(name: name, bundleID: bundleID, script: tabScript(bundleID, tab: "active tab"))
    }

    private static func tabScript(_ bundleID: String, tab: String) -> String {
        """
        set found to {}
        tell application id "\(bundleID)"
            repeat with w in windows
                try
                    set end of found to (URL of \(tab) of w)
                end try
            end repeat
        end tell
        set AppleScript's text item delimiters to linefeed
        return found as text
        """
    }
}
