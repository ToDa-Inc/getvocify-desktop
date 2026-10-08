import Foundation

/// Who Google Meet shows speaking, read from the Meet page by the Vocify Chrome extension and
/// passed to the app through Chrome native messaging. Only display names travel, never audio.
public struct MeetSpeaking: Equatable {
    public let speaking: [String]

    /// The extension's message type, and the distributed notification the native host posts.
    public static let type = "meet-speakers"
    public static let notification = "com.vocify.meet-speakers"
    private static let maxNames = 12
    private static let maxNameLength = 80

    public init(speaking: [String]) {
        self.speaking = Set(speaking).sorted()
    }

    /// `{"type":"meet-speakers","speaking":["Marta García"]}`, or nil for anything else.
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

/// Chrome native messaging framing: each message is a 32-bit length in native byte order,
/// then that many bytes of UTF-8 JSON.
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

    /// Frames one message the way Chrome does (used by checks).
    public static func frame(_ message: Data) -> Data {
        var length = UInt32(message.count)
        var out = Data(bytes: &length, count: 4)
        out.append(message)
        return out
    }
}

/// The manifest that tells Chrome where the Vocify native host is and which extension may use it.
public enum NativeHost {
    /// Lowercase letters, digits, dots and underscores only (Chrome's rule for host names).
    public static let name = "com.vocify.speakers"

    /// An extension ID is 32 letters from a to p.
    public static func isExtensionID(_ id: String) -> Bool {
        id.count == 32 && id.allSatisfy { ("a"..."p").contains($0) }
    }

    public static func manifest(path: String, extensionIDs: [String]) -> Data {
        let origins = extensionIDs.filter(isExtensionID).map { "chrome-extension://\($0)/" }
        let manifest: [String: Any] = [
            "name": name,
            "description": "Vocify: who Google Meet shows speaking",
            "path": path,
            "type": "stdio",
            "allowed_origins": origins,
        ]
        return (try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])) ?? Data()
    }
}
