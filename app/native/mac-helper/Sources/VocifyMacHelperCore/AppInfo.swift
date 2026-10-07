import AppKit
import Foundation

/// App information for mic activity
public struct AppInfo: Codable, Equatable {
    public let bundleId: String
    public let name: String
    public let pid: Int32
    public let path: String

    enum CodingKeys: String, CodingKey {
        case bundleId = "bundleId"
        case name
        case pid
        case path
    }
}

/// Mic activity event
public struct MicEvent: Codable {
    public let event: String
    public let apps: [AppInfo]

    public init(apps: [AppInfo]) {
        self.event = "mic"
        self.apps = apps
    }
}

/// Pure-logic utilities for finding running applications
public struct AppRegistry {
    /// List of call apps: Zoom, Teams, Slack, Discord, FaceTime, Safari, Chrome, etc.
    private static let callAppBundles = Set([
        "us.zoom.xos",
        "com.microsoft.teams2",
        "com.microsoft.teams",
        "com.tinyspeck.slackmacgap",
        "com.apple.FaceTime",
        "net.whatsapp.WhatsApp",
        "ru.keepcoder.Telegram",
        "com.hnc.Discord",
        "Cisco-Systems.Spark",
        "com.google.Chrome",
        "com.apple.Safari",
        "com.apple.WebKit",
        "company.thebrowser.Browser",
        "com.microsoft.edgemac",
        "org.mozilla.firefox",
        "com.brave.Browser"
    ])

    /// Check if a bundle ID is a call app
    public static func isCallApp(_ bundleId: String) -> Bool {
        callAppBundles.contains { bundleId == $0 || bundleId.hasPrefix($0 + ".") }
    }

    /// Find the owning application for a given bundle ID and PID
    public static func findOwningApp(bundleId: String, pid: pid_t) -> NSRunningApplication? {
        let running = NSWorkspace.shared.runningApplications

        // First, try to match by PID with a regular app
        if let app = running.first(where: { $0.processIdentifier == pid }),
           app.activationPolicy == .regular {
            return app
        }

        // Otherwise, find the main app that matches this bundle ID (for helper processes)
        guard !bundleId.isEmpty else { return nil }
        return running
            .filter { $0.activationPolicy == .regular }
            .filter { app in
                app.bundleIdentifier.map { bundle in
                    bundleId == bundle || bundleId.hasPrefix(bundle + ".")
                } ?? false
            }
            .max { ($0.bundleIdentifier?.count ?? 0) < ($1.bundleIdentifier?.count ?? 0) }
    }

    /// Get human-readable name for an app
    public static func displayName(bundleId: String, runningApp: NSRunningApplication?) -> String {
        // Special case for Zoom
        if bundleId == "us.zoom.xos" {
            return "Zoom"
        }

        if let app = runningApp {
            return app.localizedName ?? app.bundleIdentifier ?? bundleId
        }

        return bundleId
    }
}
