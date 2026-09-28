import Foundation

/// Meetings in progress or not yet sent, one JSON file each, so a quit, crash or
/// failed upload never loses what was transcribed. The dashboard owns the format.
enum MeetingDrafts {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Vocify/meetings", isDirectory: true)
    }

    static func save(_ draft: [String: Any]) -> Bool {
        guard let file = file(for: draft["id"]),
              JSONSerialization.isValidJSONObject(draft),
              let data = try? JSONSerialization.data(withJSONObject: draft) else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    static func list() -> [Any] {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? Data(contentsOf: $0) }
            .compactMap { try? JSONSerialization.jsonObject(with: $0) }
    }

    static func remove(id: Any?) {
        guard let file = file(for: id) else { return }
        try? FileManager.default.removeItem(at: file)
    }

    private static func file(for id: Any?) -> URL? {
        guard let id = id as? String, !id.isEmpty,
              id.range(of: #"^[A-Za-z0-9-]{1,64}$"#, options: .regularExpression) != nil else { return nil }
        return directory.appendingPathComponent("\(id).json")
    }
}
