import Foundation

enum SaasProxy {
    static func isAllowedBase(_ raw: String) -> Bool {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host?.lowercased()
        else { return false }
        if url.scheme == "https", host == "api.getvocify.com" || host == "staging-api.getvocify.com" { return true }
        if (url.scheme == "http" || url.scheme == "https"),
           host == "localhost" || host == "127.0.0.1" { return true }
        if host.contains("railway.app") { return true }
        return false
    }

    static func request(_ payload: [String: Any]) async -> [String: Any] {
        guard let base = payload["base"] as? String, isAllowedBase(base) else {
            return ["ok": false, "status": 0, "data": [:], "error": "API base is not a Vocify host"]
        }
        let path = payload["path"] as? String ?? ""
        let method = (payload["method"] as? String ?? "GET").uppercased()
        let headers = payload["headers"] as? [String: String] ?? [:]
        let root = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = path.hasPrefix("/") ? path : "/\(path)"
        guard let url = URL(string: "\(root)\(suffix)") else {
            return ["ok": false, "status": 0, "data": [:], "error": "Invalid URL"]
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body = payload["body"] {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if JSONSerialization.isValidJSONObject(body),
               let data = try? JSONSerialization.data(withJSONObject: body) {
                request.httpBody = data
            } else if let text = body as? String {
                request.httpBody = Data(text.utf8)
            }
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let http = response as? HTTPURLResponse
            let status = http?.statusCode ?? 0
            var json: Any = [:]
            if !data.isEmpty, let parsed = try? JSONSerialization.jsonObject(with: data) {
                json = parsed
            }
            if status >= 200, status < 300 {
                return ["ok": true, "status": status, "data": DesktopBridge.webKitSafe(json)]
            }
            let detail = (json as? [String: Any])?["detail"] as? String
            return [
                "ok": false,
                "status": status,
                "data": DesktopBridge.webKitSafe(json),
                "error": detail ?? "HTTP \(status)",
            ]
        } catch {
            return ["ok": false, "status": 0, "data": [:], "error": error.localizedDescription]
        }
    }
}
