import Foundation

/// Where a call happens and what that makes it: a meeting app or page (Zoom, Teams, Meet)
/// or a phone/dialer (HubSpot calling, Aircall, WhatsApp). Decided on the Mac from the app
/// holding the mic and, for browsers, the page on screen; only the name and kind leave it.
/// `kind` is nil when the app does both (FaceTime) or isn't known: then nothing is claimed.
public struct CallSource: Equatable, Sendable {
    public enum Kind: String, Sendable { case call, meeting }

    public let name: String
    public let kind: Kind?

    public init(name: String, kind: Kind?) {
        self.name = name
        self.kind = kind
    }

    private static let apps: [(prefix: String, source: CallSource)] = [
        ("us.zoom.xos", CallSource(name: "Zoom", kind: .meeting)),
        ("com.microsoft.teams", CallSource(name: "Microsoft Teams", kind: .meeting)),
        ("Cisco-Systems.Spark", CallSource(name: "Webex", kind: .meeting)),
        ("com.tinyspeck.slackmacgap", CallSource(name: "Slack", kind: .meeting)),
        ("com.hnc.Discord", CallSource(name: "Discord", kind: .meeting)),
        ("net.whatsapp.WhatsApp", CallSource(name: "WhatsApp", kind: .call)),
        ("ru.keepcoder.Telegram", CallSource(name: "Telegram", kind: .call)),
        ("com.apple.FaceTime", CallSource(name: "FaceTime", kind: nil)),
    ]

    /// A native call app, by bundle id (helpers included). Browsers are read by their page.
    public static func app(bundleID: String?) -> CallSource? {
        guard let bundleID else { return nil }
        // Prefix: helpers ("….helper") and new generations ("com.microsoft.teams2") count too.
        return apps.first { bundleID.hasPrefix($0.prefix) }?.source
    }

    /// The first page that is a call or meeting, front window first.
    public static func page(in urls: [String]) -> CallSource? {
        urls.lazy.compactMap(page(_:)).first
    }

    public static func page(_ url: String) -> CallSource? {
        guard let components = URLComponents(string: url.trimmingCharacters(in: .whitespaces)),
              components.scheme == "https",
              let host = components.host?.lowercased() else { return nil }
        let path = components.path.lowercased()
        func on(_ domain: String) -> Bool { host == domain || host.hasSuffix("." + domain) }
        if host == "meet.google.com" { return CallSource(name: "Google Meet", kind: .meeting) }
        if host == "teams.microsoft.com" || host == "teams.live.com" { return CallSource(name: "Microsoft Teams", kind: .meeting) }
        if on("zoom.us"), path.hasPrefix("/wc") || path.hasPrefix("/j/") || host == "app.zoom.us" {
            return CallSource(name: "Zoom", kind: .meeting)
        }
        if on("webex.com") { return CallSource(name: "Webex", kind: .meeting) }
        if on("whereby.com") { return CallSource(name: "Whereby", kind: .meeting) }
        if on("hubspot.com"), host.hasPrefix("app"), path.contains("calling-integration-popup") {
            return CallSource(name: "HubSpot", kind: .call)
        }
        if host == "phone.aircall.io" { return CallSource(name: "Aircall", kind: .call) }
        if host == "app.ringover.com" { return CallSource(name: "Ringover", kind: .call) }
        if on("dialpad.com") { return CallSource(name: "Dialpad", kind: .call) }
        if host == "app.justcall.io" { return CallSource(name: "JustCall", kind: .call) }
        if host == "web.whatsapp.com" { return CallSource(name: "WhatsApp", kind: .call) }
        return nil
    }

    public var json: [String: Any] {
        ["name": name, "kind": kind?.rawValue ?? NSNull()]
    }
}
