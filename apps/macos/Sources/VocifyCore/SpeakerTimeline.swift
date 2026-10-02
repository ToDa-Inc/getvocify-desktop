import Foundation

/// Who the meeting app showed as speaking, over the call's clock (seconds since recording began).
/// Read from the app's screen a few times a second; a "Them" sentence is credited to whoever was
/// shown speaking for most of the time it was said.
public struct SpeakerTimeline: Equatable {
    private struct Sample: Equatable {
        let at: Double
        let names: [String]
    }

    private var samples: [Sample] = []
    /// A sample stands for this long when the next one is late.
    private static let sampleSpan = 1.0
    private static let slack = 0.3

    public init() {}

    public var isEmpty: Bool { samples.isEmpty }

    /// Records what the app shows now; repeats of the same speakers are folded.
    public mutating func record(at time: Double, speaking names: [String]) {
        if let last = samples.last, last.names == names, time - last.at < Self.sampleSpan { return }
        samples.append(Sample(at: time, names: names))
    }

    /// The person shown speaking for most of [start, end], or nil when nobody was.
    public func name(from start: Double, to end: Double) -> String? {
        var time: [String: Double] = [:]
        for (index, sample) in samples.enumerated() {
            let next = index + 1 < samples.count ? samples[index + 1].at : sample.at + Self.sampleSpan
            let from = max(sample.at, start - Self.slack)
            let to = min(min(next, sample.at + Self.sampleSpan), end + Self.slack)
            guard to > from else { continue }
            for name in sample.names { time[name, default: 0] += to - from }
        }
        return time.max { $0.value < $1.value }?.key
    }
}

/// How Zoom describes a video tile to Accessibility: "Marta García, Computer audio, Active speaker".
/// Same reading as lucassynnott/meeting-notes (native/zoom-observer).
public enum ZoomTile {
    private static let audioMarkers = [
        ", Computer audio", ", No audio connected", ", Phone audio", ", Device audio", ", Telephone", ", Call me",
    ]

    /// The tile's name when Zoom marks it as the active speaker, else nil.
    public static func speakingName(_ description: String) -> String? {
        guard description.lowercased().contains("active speaker") else { return nil }
        let ends = audioMarkers.compactMap { description.range(of: $0)?.lowerBound }
        guard let end = ends.min() ?? description.range(of: ", Active speaker", options: .caseInsensitive)?.lowerBound else {
            return nil
        }
        let name = description[..<end].trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? nil : name
    }
}
