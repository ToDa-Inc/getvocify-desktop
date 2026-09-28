import Foundation
import VocifyCore

enum APIError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

struct VocifyAPI {
    var base: String
    var token: String?

    func me() async throws {
        _ = try await send("/auth/me", method: "GET", body: nil)
    }

    func login(email: String, password: String) async throws -> (token: String, refresh: String?) {
        let data = try await send("/auth/login", method: "POST", body: ["email": email, "password": password])
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let token = json?["access_token"] as? String, !token.isEmpty else {
            throw APIError.message("Login sin token")
        }
        return (token, json?["refresh_token"] as? String)
    }

    func uploadTranscript(_ transcript: String) async throws -> String {
        let data = try await send(
            "/memos/upload-and-extract",
            method: "POST",
            body: ["transcript": transcript, "source_type": "meeting_transcript"]
        )
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let id = json?["id"] as? String, !id.isEmpty { return id }
        if let id = json?["id"] as? Int { return String(id) }
        throw APIError.message("El memo no devolvió id")
    }

    func memo(_ id: String) async throws -> [String: Any] {
        let data = try await send("/memos/\(id)", method: "GET", body: nil)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    func preview(_ id: String) async throws -> [String: Any] {
        let data = try await send("/memos/\(id)/preview", method: "GET", body: nil)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    func approve(memoId: String, body: ApproveBody) async throws {
        let encoded = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: encoded)
        _ = try await send("/memos/\(memoId)/approve", method: "POST", json: object)
    }

    func checklist() async throws -> [String: Any] {
        let data = try await send("/copilot/checklist", method: "POST", body: ["call_mode": "meeting"])
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    func suggest(transcript: String, latest: String) async throws -> (text: String, evidence: Int, playbookReady: Bool) {
        let data = try await send(
            "/copilot/suggest",
            method: "POST",
            body: [
                "transcript_window": String(transcript.suffix(6000)),
                "latest_turn": latest,
                "language": "auto",
                "call_mode": "meeting",
            ]
        )
        let raw = String(data: data, encoding: .utf8) ?? ""
        var text = ""
        var evidence = 0
        var ready = false
        for line in raw.split(separator: "\n") {
            let row = line.hasPrefix("data:") ? String(line.dropFirst(5)) : String(line)
            guard let blob = row.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: blob) as? [String: Any],
                  (event["type"] as? String) == "result" else { continue }
            ready = event["playbook_ready"] as? Bool == true
            evidence = (event["evidence_refs"] as? [Any])?.count ?? 0
            if let direct = event["text"] as? String { text = direct }
            if let suggestion = event["suggestion"] as? [String: Any] {
                text = (suggestion["text"] as? String) ?? (suggestion["say_this"] as? String) ?? text
            }
        }
        return (text, evidence, ready)
    }

    private func send(_ path: String, method: String, body: [String: String]?) async throws -> Data {
        try await send(path, method: method, json: body)
    }

    private func send(_ path: String, method: String, json: Any?) async throws -> Data {
        let root = LiveURL.apiBase(base)
        guard let url = URL(string: root + path) else { throw APIError.message("URL inválida") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"]
            let message = detail as? String ?? "HTTP \(code)"
            throw APIError.message(message)
        }
        return data
    }
}
