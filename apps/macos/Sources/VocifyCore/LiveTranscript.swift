import Foundation

/// The live call transcript, built natively from the transcription socket so the island never
/// waits on the dashboard. Same rules and JSON shape as the dashboard's `meeting-transcript.ts`
/// (which still builds the uploaded text from `json()`):
/// - each side keeps one in-progress tail; a final replaces it exactly once;
/// - bubbles keep the order and key their first words appeared with, so nothing on screen moves;
/// - the mic hearing the call through the speakers (echo) is not shown as the rep;
/// - a side restarted in another language (ChannelReset) drops its words from that point.
public struct LiveTranscript: Equatable {
    public enum Speaker: String { case rep, prospect }

    public struct Segment: Equatable {
        public let speaker: Speaker?
        public let text: String
        public let start: Double?
        public let end: Double?
        public let seen: Int
    }

    public struct Row: Equatable {
        public let key: String
        public let speaker: Speaker?
        public var text: String
        public var pending: String

        public var you: Bool { speaker == .rep }
        public var label: String? { speaker.map { $0 == .rep ? "You" : "Them" } }
    }

    public private(set) var segments: [Segment] = []
    /// Settled bubbles, rebuilt only when a final lands (tails change ~10×/s, finals ~1×/s).
    private var settled: [Row] = []
    /// Each segment's words, for the echo check.
    private var tokens: [[String]] = []
    private var interims: [String: String] = [:]
    private var interimStarts: [String: Double] = [:]
    private var interimSeen: [String: Int] = [:]
    private var nextSeen = 0

    private static let order = ["rep", "prospect", "unknown"]
    /// How far apart two channels' words can be and still be the same sound.
    private static let echoWindow = 1.5
    /// Share of a mic segment's words that must also be in the meeting audio to count as echo.
    private static let echoOverlap = 0.6

    public init() {}

    public var hasSpeech: Bool { !segments.isEmpty || interims.values.contains { !$0.isEmpty } }

    /// Applies one result; false when nothing changed.
    @discardableResult
    public mutating func apply(text raw: String, isFinal: Bool, channel: String?, start: Double?, end: Double?) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let speaker = channel.flatMap(Speaker.init(rawValue:))
        let key = speaker?.rawValue ?? "unknown"
        if text.isEmpty {
            // An empty final closes that side's utterance; an empty interim changes nothing.
            guard isFinal, interims[key] != nil else { return false }
            dropTail(key)
            return true
        }
        if !isFinal {
            guard interims[key] != text else { return false }
            interims[key] = text
            if let start { interimStarts[key] = start }
            if interimSeen[key] == nil {
                interimSeen[key] = nextSeen
                nextSeen += 1
            }
            return true
        }
        let seen: Int
        if let open = interimSeen[key] {
            seen = open
        } else {
            seen = nextSeen
            nextSeen += 1
        }
        segments.append(Segment(speaker: speaker, text: text, start: start, end: end ?? start, seen: seen))
        tokens.append(Self.words(text))
        dropTail(key)
        settle()
        return true
    }

    /// One side restarted in its real language and sends its words from `from` again.
    @discardableResult
    public mutating func reset(channel: String?, from: Double?) -> Bool {
        guard let speaker = channel.flatMap(Speaker.init(rawValue:)), let from else { return false }
        let keep = segments.map { !($0.speaker == speaker && ($0.start ?? -1) >= from - 0.01) }
        let hadTail = interims[speaker.rawValue] != nil
        dropTail(speaker.rawValue)
        guard keep.contains(false) else { return hadTail }
        segments = zip(segments, keep).filter(\.1).map(\.0)
        tokens = zip(tokens, keep).filter(\.1).map(\.0)
        settle()
        return true
    }

    private mutating func dropTail(_ key: String) {
        interims[key] = nil
        interimStarts[key] = nil
        interimSeen[key] = nil
    }

    // MARK: What the island shows

    private mutating func settle() {
        let meeting = segments.indices.filter { segments[$0].speaker == .prospect }
        let items: [(seen: Int, speaker: Speaker?, text: String, pending: String)] = segments.indices
            .filter { !isEcho($0, meeting: meeting) }
            .map { segments[$0] }
            .sorted { $0.seen < $1.seen }
            .map { ($0.seen, $0.speaker, $0.text, "") }
        settled = Self.merge(items, into: [])
    }

    public func rows() -> [Row] {
        let items: [(seen: Int, speaker: Speaker?, text: String, pending: String)] = Self.order.compactMap { key in
            guard let pending = interims[key], !pending.isEmpty else { return nil }
            return (interimSeen[key] ?? nextSeen, Speaker(rawValue: key), "", pending)
        }
        .sorted { $0.seen < $1.seen }
        // A tail older than the last settled bubble still goes last: settled bubbles never move.
        return Self.merge(items, into: settled)
    }

    private static func merge(
        _ items: [(seen: Int, speaker: Speaker?, text: String, pending: String)],
        into start: [Row]
    ) -> [Row] {
        var rows = start
        for item in items {
            if var last = rows.last, last.pending.isEmpty,
               last.speaker == item.speaker || item.speaker == nil || last.speaker == nil {
                // A fragment without a channel continues whoever was talking.
                let speaker = last.speaker ?? item.speaker
                if item.pending.isEmpty {
                    last.text = joinChunks(last.text, item.text)
                } else {
                    last.pending = item.pending
                }
                rows[rows.count - 1] = Row(key: last.key, speaker: speaker, text: last.text, pending: last.pending)
                continue
            }
            rows.append(Row(key: "u\(item.seen)", speaker: item.speaker, text: item.text, pending: item.pending))
        }
        return rows
    }

    /// Joins streamed chunks so "hola" + ", qué tal" reads "hola, qué tal".
    public static func joinChunks(_ left: String, _ right: String) -> String {
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        if let first = right.first, ",.;:!?…)".contains(first) { return left + right }
        return left + " " + right
    }

    private static func words(_ text: String) -> [String] {
        text.lowercased()
            .folding(options: .diacriticInsensitive, locale: nil)
            .components(separatedBy: CharacterSet.letters.union(.decimalDigits).union(CharacterSet(charactersIn: "'")).inverted)
            .filter { !$0.isEmpty }
    }

    /// A mic segment whose words were said on the meeting audio at the same moment is echo.
    private func isEcho(_ index: Int, meeting: [Int]) -> Bool {
        let segment = segments[index]
        guard segment.speaker == .rep, let start = segment.start else { return false }
        let own = tokens[index]
        guard !own.isEmpty else { return false }
        let end = segment.end ?? start
        var heard = Set<String>()
        for other in meeting {
            guard let otherStart = segments[other].start else { continue }
            let otherEnd = segments[other].end ?? otherStart
            if otherStart <= end + Self.echoWindow, otherEnd >= start - Self.echoWindow {
                tokens[other].forEach { heard.insert($0) }
            }
        }
        guard !heard.isEmpty else { return false }
        let shared = own.filter { heard.contains($0) }.count
        return own.count <= 2 ? shared == own.count : Double(shared) / Double(own.count) >= Self.echoOverlap
    }

    // MARK: The dashboard's MeetingTranscript

    public func json() -> [String: Any] {
        [
            "segments": segments.map { segment -> [String: Any] in
                [
                    "speaker": segment.speaker?.rawValue ?? NSNull(),
                    "text": segment.text,
                    "start": segment.start ?? NSNull(),
                    "end": segment.end ?? NSNull(),
                    "seen": segment.seen,
                ]
            },
            "interims": interims,
            "interimStarts": interimStarts,
            "interimSeen": interimSeen,
            "nextSeen": nextSeen,
        ]
    }
}
