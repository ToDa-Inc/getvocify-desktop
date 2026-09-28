import Foundation

public struct NoteTurn: Equatable {
    public var speaker: String
    public var committed: String
    public var live: String

    public init(speaker: String, text: String, interim: Bool) {
        self.speaker = speaker
        self.committed = interim ? "" : text
        self.live = interim ? text : ""
    }

    public var interim: Bool { !live.isEmpty }

    /// One paragraph. Interim is only the unfinished tail, never its own row.
    public var text: String {
        if committed.isEmpty { return live }
        if live.isEmpty { return committed }
        if live.hasPrefix(committed) { return live }
        return "\(committed) \(live)"
    }

    public var label: String {
        switch speaker {
        case "rep": return "Tú"
        case "prospect": return "Otro"
        default: return ""
        }
    }
}

public struct LiveNote {
    public private(set) var turns: [NoteTurn] = []

    public init() {}

    public mutating func apply(text: String, isFinal: Bool, speaker: String) {
        let piece = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !piece.isEmpty else { return }
        if !isFinal {
            applyInterim(piece, speaker: speaker)
            return
        }
        applyFinal(piece, speaker: speaker)
    }

    public var uploadText: String {
        turns.filter { !$0.text.isEmpty }.map { turn in
            turn.label.isEmpty ? turn.text : "\(turn.label): \(turn.text)"
        }.joined(separator: " ")
    }

    public var latestFinal: String {
        turns.last { !$0.interim }?.text ?? ""
    }

    private mutating func applyInterim(_ piece: String, speaker: String) {
        let index = ensureTurn(speaker)
        turns[index].live = piece
    }

    private mutating func applyFinal(_ piece: String, speaker: String) {
        let index = ensureTurn(speaker)
        let prior = turns[index].committed
        if piece.hasPrefix(prior) || prior.isEmpty {
            turns[index].committed = piece
        } else if !turns[index].live.isEmpty && (piece == turns[index].live || piece.hasPrefix(turns[index].live)) {
            turns[index].committed = join(prior, piece)
        } else {
            turns[index].committed = join(prior, piece)
        }
        turns[index].live = ""
    }

    /// Same speaker, or an unknown speaker, stays on the open paragraph.
    private mutating func ensureTurn(_ speaker: String) -> Int {
        if let index = turns.indices.last {
            let current = turns[index].speaker
            let changed = !speaker.isEmpty && !current.isEmpty && speaker != current
            if !changed {
                if !speaker.isEmpty { turns[index].speaker = speaker }
                return index
            }
        }
        turns.append(NoteTurn(speaker: speaker, text: "", interim: false))
        return turns.count - 1
    }

    private func join(_ left: String, _ right: String) -> String {
        "\(left) \(right)"
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public extension ChannelAudio {
    static func speaker(from event: [String: Any]) -> String {
        if let raw = event["audio_channel"] as? String {
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if value == "rep" || value == "you" { return "rep" }
            if value == "prospect" || value == "them" { return "prospect" }
        }
        if let channel = event["audio_channel"] as? Int {
            return channel == 0 ? "prospect" : "rep"
        }
        if let channel = event["audio_channel"] as? Double {
            return Int(channel) == 0 ? "prospect" : "rep"
        }
        if let index = event["channel_index"] as? [Int], let channel = index.first {
            return channel == 0 ? "prospect" : "rep"
        }
        if let index = event["channel_index"] as? [Double], let channel = index.first {
            return Int(channel) == 0 ? "prospect" : "rep"
        }
        return ""
    }
}
