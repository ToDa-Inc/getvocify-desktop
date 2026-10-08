import AppKit
import ApplicationServices
import Foundation

// Who the meeting app shows speaking: Zoom read through Accessibility, Google Meet as reported by the
// Vocify Chrome extension through Chrome native messaging. Only display names, never audio.
// A port of the Swift app's ActiveSpeakers.swift, SpeakerTimeline.swift (ZoomTile) and MeetSpeakers.swift (same rules).

/// How Zoom describes a video tile to Accessibility: "Marta García, Computer audio, Active speaker".
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

/// Zoom's "Zoom Meeting" window, read through Accessibility (needs Vocify allowed under Accessibility).
public enum ZoomSpeakers {
    public static let bundleID = "us.zoom.xos"

    /// Asks once for Accessibility when `prompt`; afterwards macOS remembers the answer.
    public static func ensureTrusted(prompt: Bool) -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// The names shown as speaking, [] when nobody is, nil when Zoom isn't in a meeting or can't be read.
    public static func read() -> [String]? {
        guard AXIsProcessTrusted(),
              let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { return nil }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        let windows = children(root).filter { string($0, kAXRoleAttribute) == kAXWindowRole }
        guard let meeting = windows.first(where: { string($0, kAXTitleAttribute)?.lowercased().hasPrefix("zoom meeting") == true }) else {
            return nil
        }
        var speaking = Set<String>()
        var queue: [(AXUIElement, Int)] = [(meeting, 0)]
        var visited = 0
        while !queue.isEmpty, visited < 1500 {
            let (element, depth) = queue.removeFirst()
            visited += 1
            if let description = string(element, kAXDescriptionAttribute), let name = ZoomTile.speakingName(description) {
                speaking.insert(name)
            }
            if depth < 5 { queue.append(contentsOf: children(element).map { ($0, depth + 1) }) }
        }
        return speaking.sorted()
    }

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        var value: AnyObject?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
        return value as? [AXUIElement] ?? []
    }

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: AnyObject?
        AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return value as? String
    }
}

/// Who Google Meet shows speaking, from the Vocify Chrome extension: `{"type":"meet-speakers","speaking":[...]}`.
public struct MeetSpeaking: Equatable {
    public let speaking: [String]

    /// The extension's message type, and the distributed notification the native host posts
    /// (the same one the Swift app listens to, so either app gets Meet's speakers).
    public static let type = "meet-speakers"
    public static let notification = "com.vocify.meet-speakers"
    private static let maxNames = 12
    private static let maxNameLength = 80

    public init(speaking: [String]) {
        self.speaking = Set(speaking).sorted()
    }

    public static func parse(_ data: Data) -> MeetSpeaking? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["type"] as? String == type,
              let raw = object["speaking"] as? [Any], raw.count <= maxNames else { return nil }
        var names: [String] = []
        for item in raw {
            guard let name = (item as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty, name.count <= maxNameLength else { return nil }
            names.append(name)
        }
        return MeetSpeaking(speaking: names)
    }

    public func json() -> String {
        let data = (try? JSONSerialization.data(withJSONObject: ["type": Self.type, "speaking": speaking])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// Chrome native messaging framing: a 32-bit length in native byte order, then that many bytes of UTF-8 JSON.
public struct NativeMessageReader {
    /// A speaker list is tiny; anything this large is not ours.
    public static let maxMessage = 64 * 1024
    private var buffer = Data()

    public init() {}

    /// Adds bytes read from stdin and returns the whole messages, or nil when a frame is malformed.
    public mutating func append(_ data: Data) -> [Data]? {
        buffer.append(data)
        var messages: [Data] = []
        while buffer.count >= 4 {
            let length = Int(buffer.prefix(4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) })
            guard length <= Self.maxMessage else { return nil }
            guard buffer.count >= 4 + length else { break }
            messages.append(Data(buffer.dropFirst(4).prefix(length)))
            buffer = Data(buffer.dropFirst(4 + length))
        }
        return messages
    }

    /// Frames one message the way Chrome does (tests).
    public static func frame(_ message: Data) -> Data {
        var length = UInt32(message.count)
        var out = Data(bytes: &length, count: 4)
        out.append(message)
        return out
    }
}
