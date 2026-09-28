import Foundation

public struct AssistLine {
    public var helpOn: Bool
    public var text: String
    public var shownAt: Date?

    public init(helpOn: Bool = false, text: String = "", shownAt: Date? = nil) {
        self.helpOn = helpOn
        self.text = text
        self.shownAt = shownAt
    }

    public func visible(now: Date, speakerIsRep: Bool) -> String? {
        guard helpOn, !speakerIsRep else { return nil }
        guard let shownAt, !text.isEmpty else { return nil }
        if now.timeIntervalSince(shownAt) >= 10 { return nil }
        return text.count > 90 ? String(text.prefix(90)) : text
    }

    public func present(_ raw: String, evidenceCount: Int, playbookReady: Bool, now: Date) -> AssistLine {
        var next = self
        let line = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard helpOn, playbookReady, evidenceCount > 0, !line.isEmpty else { return next }
        next.text = line.count > 90 ? String(line.prefix(90)) : line
        next.shownAt = now
        return next
    }
}
