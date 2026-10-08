import Foundation

/// The CRM contact on screen the island offers to call (`shell:state` `onScreen`).
/// Contract: getvocify docs/superpowers/specs/2026-10-06-desktop-calling-design.md.
public struct OnScreenCall: Equatable, Sendable {
    public enum State: String, Sendable {
        case callable
        case noPhone = "no_phone"
        case needsContact = "needs_contact"
        case noCallerId = "no_caller_id"
    }

    public let provider: String
    public let crmLabel: String
    public let name: String?
    /// E.164.
    public let phone: String?
    /// The verified number the call goes out from.
    public let callerId: String?
    public let state: State
    /// What happened with the contact lately (the dashboard's recent-activity summary): loading, or its lines.
    public var brief: Brief? = nil

    public enum Brief: Equatable, Sendable {
        case loading
        case ready([String])
    }

    /// The island is a glance: two lines at most.
    static let briefLineLimit = 2

    /// How many brief lines the offer shows (a loading brief takes one).
    public var briefLines: Int {
        switch brief {
        case .loading: return 1
        case .ready(let lines): return lines.count
        case nil: return 0
        }
    }

    static func decodeBrief(_ raw: Any?) -> Brief? {
        guard let dict = raw as? [String: Any] else { return nil }
        if dict["state"] as? String == "loading" { return .loading }
        guard dict["state"] as? String == "ready", let raw = dict["lines"] as? [Any] else { return nil }
        let lines = raw.compactMap { nonEmpty($0) }.prefix(briefLineLimit)
        return lines.isEmpty ? nil : .ready(Array(lines))
    }

    public static func decode(_ raw: Any?) -> OnScreenCall? {
        guard let dict = raw as? [String: Any],
              let state = (dict["state"] as? String).flatMap(State.init(rawValue:)),
              let provider = dict["provider"] as? String,
              let crmLabel = dict["crmLabel"] as? String
        else { return nil }
        return OnScreenCall(
            provider: provider,
            crmLabel: crmLabel,
            name: nonEmpty(dict["name"]),
            phone: nonEmpty(dict["phone"]),
            callerId: nonEmpty(dict["callerId"]),
            state: state,
            brief: decodeBrief(dict["brief"])
        )
    }
}

/// A Vocify call in progress, or one that ended unanswered (`shell:state` `dial`).
public struct DialIslandState: Equatable, Sendable {
    public enum Phase: String, Sendable { case connecting, ringing, active, ended }

    public let phase: Phase
    public let name: String?
    public let phone: String
    public let answeredAt: Date?
    public let muted: Bool
    /// Why an unanswered call ended, in the rep's language.
    public let message: String?

    public static func decode(_ raw: Any?) -> DialIslandState? {
        guard let dict = raw as? [String: Any],
              let phase = (dict["phase"] as? String).flatMap(Phase.init(rawValue:)),
              let phone = nonEmpty(dict["phone"])
        else { return nil }
        let answeredMs = (dict["answeredAt"] as? NSNumber)?.doubleValue
        return DialIslandState(
            phase: phase,
            name: nonEmpty(dict["name"]),
            phone: phone,
            answeredAt: answeredMs.map { Date(timeIntervalSince1970: $0 / 1000) },
            muted: (dict["muted"] as? Bool) ?? false,
            message: nonEmpty(dict["message"])
        )
    }

    /// While a Vocify call is up the island must not offer or start any other recording.
    public static func isCallUp(_ dial: DialIslandState?) -> Bool {
        guard let dial else { return false }
        return dial.phase != .ended
    }
}

/// The dashboard's phone display (`formatCallerIdDisplay`): Spanish numbers grouped, others as stored.
public enum PhoneFormat {
    public static func grouped(_ e164: String) -> String {
        let digits = e164.filter(\.isNumber)
        guard e164.hasPrefix("+34"), digits.count == 11 else { return e164 }
        let national = Array(digits.dropFirst(2))
        let part = { (from: Int, to: Int) in String(national[from..<to]) }
        return "+34 \(part(0, 3)) \(part(3, 5)) \(part(5, 7)) \(part(7, 9))"
    }
}

/// Every call line the island shows (same copy as the Electron island).
public enum CallWording {
    public static func glyphHelp(_ s: OnScreenCall) -> String {
        switch s.state {
        case .callable: return "Call \(s.name ?? PhoneFormat.grouped(s.phone ?? ""))"
        case .noPhone: return "No phone in \(s.crmLabel)"
        case .noCallerId: return "Add a caller ID to call"
        case .needsContact: return "Open the contact to call"
        }
    }

    public static func confirm(_ s: OnScreenCall) -> (title: String, line: String, button: String?) {
        let title = s.name ?? s.phone.map(PhoneFormat.grouped) ?? s.crmLabel
        switch s.state {
        case .callable:
            return (title, PhoneFormat.grouped(s.phone ?? ""), "Call")
        case .noPhone: return (title, "No phone in \(s.crmLabel)", nil)
        case .noCallerId: return (title, "Add a caller ID to call", "Add caller ID")
        case .needsContact: return ("\(s.crmLabel) record with several contacts", "Open the contact to call", nil)
        }
    }

    public static func dialing(_ d: DialIslandState) -> String {
        "Calling \(d.name ?? PhoneFormat.grouped(d.phone))…"
    }

    public static func ended(_ d: DialIslandState) -> String {
        d.message ?? "Call ended"
    }
}

private func nonEmpty(_ value: Any?) -> String? {
    guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return text
}
