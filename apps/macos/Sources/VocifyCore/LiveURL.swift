import Foundation

public enum LiveURL {
    public static let prodAPI = "https://api.getvocify.com/api/v1"
    public static let prodApp = "https://app.getvocify.com"

    public static func dashboardEntry(webOrigin: String = prodApp, path: String = "/dashboard/record") -> URL {
        let origin = webOrigin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let p = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(origin)\(p)")!
    }

    public static func apiBase(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? prodAPI : trimmed
        return String(base.dropLast(base.hasSuffix("/") ? 1 : 0))
    }

    public static func transcription(apiBase: String, language: String = "multi") -> URL? {
        let http = LiveURL.apiBase(apiBase)
        let ws = http
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "/api/v1", with: "", options: [.backwards, .caseInsensitive])
        var parts = URLComponents(string: "\(ws)/api/v1/transcription/live")
        parts?.queryItems = [
            URLQueryItem(name: "language", value: language),
            URLQueryItem(name: "mode", value: "copilot_channels"),
            URLQueryItem(name: "channel_labels", value: "prospect,rep"),
        ]
        return parts?.url
    }
}
