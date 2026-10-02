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
        /// Who on the other side said it, when the meeting app showed it.
        public var name: String? = nil
    }

    public struct Row: Equatable {
        public let key: String
        public let speaker: Speaker?
        public var text: String
        public var pending: String
        /// When the paragraph's first and latest words were said (seconds into the call).
        public var start: Double? = nil
        public var end: Double? = nil
        /// The person on the other side, when the meeting app showed who was speaking.
        public var name: String? = nil

        public var you: Bool { speaker == .rep }
        public var label: String? { speaker.map { $0 == .rep ? "You" : name ?? "Them" } }
    }

    public private(set) var segments: [Segment] = []
    /// Settled bubbles, rebuilt only when a final lands (tails change ~10×/s, finals ~1×/s).
    private var settled: [Row] = []
    /// Each segment's words, for the echo check.
    private var tokens: [[String]] = []
    /// Whether each segment is the mic hearing the call. Kept up to date as finals arrive, so a
    /// long call never re-checks every sentence against every other one.
    private var echo: [Bool] = []
    /// Finals arrive a few seconds late at most: older sentences can't be echoes of a new one.
    private static let echoLookback = 30.0
    /// Segment indices in the order their words first showed (the order bubbles keep).
    private var seenOrder: [Int] = []
    /// Paragraphs finished more than `freezeAfter` ago can't change anymore: built once, kept.
    private var frozen: [Row] = []
    private var frozenPositions = 0
    private var latestEnd = 0.0
    private static let freezeAfter = 60.0
    private var interims: [String: String] = [:]
    private var interimStarts: [String: Double] = [:]
    private var interimSeen: [String: Int] = [:]
    private var interimNames: [String: String] = [:]
    private var nextSeen = 0

    private static let order = ["rep", "prospect", "unknown"]
    /// How far apart two channels' words can be and still be the same sound.
    private static let echoWindow = 1.5
    /// Share of a mic segment's words that must also be in the meeting audio to count as echo.
    private static let echoOverlap = 0.6
    /// "Vale", "sí, sí": this short, said while the other person was still talking, it is a
    /// reaction, not a turn. It keeps its own small bubble but doesn't cut their paragraph.
    private static let interjectionWords = 2
    private static let overlapSlack = 0.5

    private struct Item {
        let seen: Int
        let speaker: Speaker?
        let text: String
        let pending: String
        let start: Double?
        let end: Double?
        var name: String? = nil
        /// Where it sits in `seenOrder`; -1 for words still arriving.
        var position = -1
    }

    public init() {}

    public var hasSpeech: Bool { !segments.isEmpty || interims.values.contains { !$0.isEmpty } }

    /// Applies one result; false when nothing changed.
    @discardableResult
    public mutating func apply(
        text raw: String, isFinal: Bool, channel: String?, start: Double?, end: Double?, name: String? = nil
    ) -> Bool {
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
            interimNames[key] = name
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
        segments.append(Segment(speaker: speaker, text: text, start: start, end: end ?? start, seen: seen, name: name))
        tokens.append(Self.words(text))
        echo.append(false)
        // Its own live tail is done: it must not count as something else being said now.
        dropTail(key)
        let index = segments.count - 1
        var slot = seenOrder.count
        while slot > 0, segments[seenOrder[slot - 1]].seen > seen { slot -= 1 }
        seenOrder.insert(index, at: slot)
        if let end = end ?? start { latestEnd = max(latestEnd, end) }
        markEchoes(around: segments.count - 1)
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
        echo = segments.indices.map(isEcho)
        seenOrder = segments.indices.sorted { segments[$0].seen < segments[$1].seen }
        frozen = []
        frozenPositions = 0
        settle()
        return true
    }

    private mutating func dropTail(_ key: String) {
        interims[key] = nil
        interimStarts[key] = nil
        interimSeen[key] = nil
        interimNames[key] = nil
    }

    // MARK: What the island shows

    /// A new mic sentence is checked against the call; a new call sentence re-checks the mic
    /// sentences said around the same time (its final can arrive after theirs).
    private mutating func markEchoes(around index: Int) {
        let segment = segments[index]
        if segment.speaker == .rep {
            echo[index] = isEcho(index)
            return
        }
        guard segment.speaker == .prospect, let start = segment.start else { return }
        for other in segments.indices.reversed() {
            guard let otherStart = segments[other].start else { continue }
            if otherStart < start - Self.echoLookback { break }
            if segments[other].speaker == .rep { echo[other] = isEcho(other) }
        }
    }

    private mutating func settle() {
        let items: [Item] = (frozenPositions..<seenOrder.count).compactMap { position in
            let index = seenOrder[position]
            guard !echo[index] else { return nil }
            let segment = segments[index]
            return Item(
                seen: segment.seen, speaker: segment.speaker, text: segment.text, pending: "",
                start: segment.start, end: segment.end, name: segment.name, position: position
            )
        }
        let drafts = Self.mergeDrafts(items, into: [])
        // Keep finished paragraphs out of every later rebuild: well in the past, not among the
        // last two (a reaction can still join those), and with nothing later mixed into them.
        var cut = 0
        while cut < drafts.count - 2, let end = drafts[cut].end, end < latestEnd - Self.freezeAfter { cut += 1 }
        while cut > 0, drafts[..<cut].contains(where: { $0.lastPosition >= drafts[cut].firstPosition }) { cut -= 1 }
        if cut > 0 {
            frozen += drafts[..<cut].map(\.row)
            frozenPositions = drafts[cut].firstPosition
        }
        settled = frozen + drafts[cut...].map(\.row)
    }

    public func rows() -> [Row] {
        let items: [Item] = Self.order.compactMap { key in
            guard let pending = interims[key], !pending.isEmpty else { return nil }
            // The mic hearing the call while it's still being written: never shown as the rep.
            if key == Speaker.rep.rawValue, let start = interimStarts[key],
               Self.echoes(Self.words(pending), heard: heard(from: start, to: nil)) {
                return nil
            }
            let start = interimStarts[key]
            return Item(
                seen: interimSeen[key] ?? nextSeen, speaker: Speaker(rawValue: key), text: "", pending: pending,
                start: start, end: start, name: interimNames[key]
            )
        }
        .sorted { $0.seen < $1.seen }
        // A tail older than the last settled bubble still goes last: settled bubbles never move.
        // A tail can only join one of the last two paragraphs; the rest is reused as is.
        guard !items.isEmpty else { return settled }
        let kept = settled.count > 2 ? Array(settled[..<(settled.count - 2)]) : []
        return kept + Self.merge(items, into: Array(settled.suffix(2)))
    }

    /// A paragraph while it's being put together: its pieces are joined once at the end, so a
    /// long monologue is never copied again for every few words that join it.
    private struct Draft {
        let key: String
        var speaker: Speaker?
        var parts: [String]
        var pending: String
        var start: Double?
        var end: Double?
        var name: String?
        var wordCount: Int
        /// The first and last `seenOrder` positions merged into it (-1: none).
        var firstPosition = Int.max
        var lastPosition = -1

        init(_ row: Row) {
            key = row.key
            speaker = row.speaker
            parts = row.text.isEmpty ? [] : [row.text]
            pending = row.pending
            start = row.start
            end = row.end
            name = row.name
            wordCount = row.text.split(whereSeparator: \.isWhitespace).count
        }

        init(_ item: Item) {
            key = "u\(item.seen)"
            speaker = item.speaker
            parts = item.text.isEmpty ? [] : [item.text]
            pending = item.pending
            start = item.start
            end = item.end
            name = item.name
            wordCount = item.text.split(whereSeparator: \.isWhitespace).count
            if item.position >= 0 {
                firstPosition = item.position
                lastPosition = item.position
            }
        }

        var row: Row {
            var text = ""
            text.reserveCapacity(parts.reduce(0) { $0 + $1.utf8.count + 1 })
            for part in parts {
                if text.isEmpty {
                    text = part
                } else {
                    if let first = part.first, !",.;:!?…)".contains(first) { text.append(" ") }
                    text.append(part)
                }
            }
            return Row(key: key, speaker: speaker, text: text, pending: pending, start: start, end: end, name: name)
        }
    }

    private static func merge(_ items: [Item], into start: [Row]) -> [Row] {
        guard !items.isEmpty else { return start }
        return mergeDrafts(items, into: start.map(Draft.init)).map(\.row)
    }

    private static func mergeDrafts(_ items: [Item], into start: [Draft]) -> [Draft] {
        var drafts = start
        for item in items {
            guard let index = paragraph(for: item, in: drafts) else {
                drafts.append(Draft(item))
                continue
            }
            // A fragment without a channel continues whoever was talking.
            if drafts[index].speaker == nil { drafts[index].speaker = item.speaker }
            if item.pending.isEmpty {
                if !item.text.isEmpty {
                    drafts[index].parts.append(item.text)
                    drafts[index].wordCount += item.text.split(whereSeparator: \.isWhitespace).count
                }
            } else {
                drafts[index].pending = item.pending
            }
            if drafts[index].start == nil { drafts[index].start = item.start }
            if let end = item.end { drafts[index].end = max(drafts[index].end ?? end, end) }
            if drafts[index].name == nil { drafts[index].name = item.name }
            if item.position >= 0 {
                drafts[index].firstPosition = min(drafts[index].firstPosition, item.position)
                drafts[index].lastPosition = max(drafts[index].lastPosition, item.position)
            }
        }
        return drafts
    }

    /// The paragraph an item continues: the last one when it's the same speaker, or the one
    /// before a short interjection the other side made while this speaker was still talking.
    private static func paragraph(for item: Item, in rows: [Draft]) -> Int? {
        guard let last = rows.last else { return nil }
        // Another person on the same side (two guests) starts their own paragraph.
        let samePerson = last.name == nil || item.name == nil || last.name == item.name
        if last.pending.isEmpty, samePerson, last.speaker == item.speaker || item.speaker == nil || last.speaker == nil {
            return rows.count - 1
        }
        guard rows.count >= 2, let speaker = item.speaker else { return nil }
        let before = rows[rows.count - 2]
        guard before.speaker == speaker, before.pending.isEmpty,
              before.name == nil || item.name == nil || before.name == item.name,
              last.speaker != speaker, last.pending.isEmpty,
              last.wordCount <= interjectionWords,
              // Said during their paragraph: after it began and before it ended.
              let said = last.start, let began = before.start, let talking = before.end,
              said >= began - overlapSlack, said <= talking + overlapSlack else { return nil }
        return rows.count - 2
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
    private func isEcho(_ index: Int) -> Bool {
        let segment = segments[index]
        guard segment.speaker == .rep, let start = segment.start else { return false }
        return Self.echoes(tokens[index], heard: heard(from: start, to: segment.end ?? start))
    }

    /// The call's words around [start, end] (end nil: still being said), its live tail included.
    private func heard(from start: Double, to end: Double?) -> Set<String> {
        var heard = Set<String>()
        // Newest first, stopping once sentences are far older than this one.
        for other in segments.indices.reversed() where segments[other].speaker == .prospect {
            guard let otherStart = segments[other].start else { continue }
            if otherStart < start - Self.echoLookback { break }
            let otherEnd = segments[other].end ?? otherStart
            if end.map({ otherStart <= $0 + Self.echoWindow }) ?? true, otherEnd >= start - Self.echoWindow {
                tokens[other].forEach { heard.insert($0) }
            }
        }
        // What the call is saying right now counts only if it started around the same moment.
        if let tail = interims[Speaker.prospect.rawValue], let tailStart = interimStarts[Speaker.prospect.rawValue],
           end.map({ tailStart <= $0 + Self.echoWindow }) ?? true, tailStart >= start - Self.echoLookback {
            Self.words(tail).forEach { heard.insert($0) }
        }
        return heard
    }

    private static func echoes(_ own: [String], heard: Set<String>) -> Bool {
        guard !own.isEmpty, !heard.isEmpty else { return false }
        let shared = own.filter { heard.contains($0) }.count
        return own.count <= 2 ? shared == own.count : Double(shared) / Double(own.count) >= echoOverlap
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
                    "name": segment.name ?? NSNull(),
                ]
            },
            "interims": interims,
            "interimStarts": interimStarts,
            "interimSeen": interimSeen,
            "nextSeen": nextSeen,
        ]
    }
}
