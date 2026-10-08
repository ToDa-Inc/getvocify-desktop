import Foundation

/// A meeting with someone from outside, announced a minute before it starts (`shell:state`
/// `meeting`, from the rep's calendar): who it is with, what happened with them lately, a link.
public struct IslandMeeting: Equatable, Sendable {
    public let id: String
    public let who: String
    public let title: String?
    public let startsAt: Date
    public let url: URL?
    public let platform: String?
    public let brief: OnScreenCall.Brief?

    public var briefLines: Int {
        switch brief {
        case .loading: return 1
        case .ready(let lines): return lines.count
        case nil: return 0
        }
    }

    public static func decode(_ raw: Any?) -> IslandMeeting? {
        guard let dict = raw as? [String: Any],
              let id = dict["id"] as? String, !id.isEmpty,
              let who = (dict["who"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !who.isEmpty,
              let startsAt = (dict["startsAt"] as? String).flatMap(parseDate) else { return nil }
        let url = (dict["url"] as? String).flatMap(URL.init(string:)).flatMap { ["https", "http"].contains($0.scheme ?? "") ? $0 : nil }
        let title = (dict["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return IslandMeeting(
            id: id,
            who: who,
            title: title?.isEmpty == false ? title : nil,
            startsAt: startsAt,
            url: url,
            platform: dict["platform"] as? String,
            brief: OnScreenCall.decodeBrief(dict["brief"])
        )
    }

    private static func parseDate(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return plain.date(from: text) ?? fractional.date(from: text)
    }
}

public enum MeetingWording {
    /// "in 1 min", "now", "started 3 min ago" (the island is a glance: whole minutes).
    public static func when(_ startsAt: Date, now: Date) -> String {
        let seconds = startsAt.timeIntervalSince(now)
        if abs(seconds) < 30 { return "now" }
        let minutes = Int((abs(seconds) / 60).rounded())
        return seconds > 0 ? "in \(max(minutes, 1)) min" : "started \(max(minutes, 1)) min ago"
    }

    static func app(_ platform: String?) -> String? {
        switch platform {
        case "zoom": return "Zoom"
        case "meet": return "Google Meet"
        case "teams": return "Teams"
        default: return nil
        }
    }

    /// Under who it is with: the meeting's title, when, and where ("Demo · in 1 min · Zoom").
    public static func line(_ meeting: IslandMeeting, now: Date) -> String {
        [meeting.title, when(meeting.startsAt, now: now), app(meeting.platform)].compactMap { $0 }.joined(separator: " · ")
    }
}
