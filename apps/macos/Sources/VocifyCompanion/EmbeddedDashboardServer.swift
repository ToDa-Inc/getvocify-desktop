import Foundation
import Network

/// Serves bundled `Resources/web` (Vite build) for SPA routing.
final class EmbeddedDashboardServer {
    static let defaultPort: UInt16 = 47_891

    private var listener: NWListener?
    private let root: URL
    private(set) var baseURL: URL?

    init(root: URL) {
        self.root = root
    }

    func start(port: UInt16 = defaultPort) throws {
        stop()
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: .global(qos: .userInitiated))
        self.listener = listener
        baseURL = URL(string: "http://127.0.0.1:\(port)/")!
    }

    func stop() {
        listener?.cancel()
        listener = nil
        baseURL = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInitiated))
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self, let data, let request = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }
            let first = request.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
            let parts = first.split(separator: " ")
            let path = parts.count >= 2 ? String(parts[1]) : "/"
            self.respond(path: path, on: connection)
        }
    }

    private func respond(path rawPath: String, on connection: NWConnection) {
        let path = (rawPath.split(separator: "?").first.map(String.init) ?? "/").removingPercentEncoding ?? "/"
        let rootPath = root.standardizedFileURL.path
        let candidate = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        var isDirectory: ObjCBool = false
        let servesFile = candidate.path.hasPrefix(rootPath + "/")
            && FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory)
            && !isDirectory.boolValue
        let fileURL = servesFile ? candidate : root.appendingPathComponent("index.html")
        guard let body = try? Data(contentsOf: fileURL) else {
            send(status: 404, body: Data("Not found".utf8), type: "text/plain", cache: "no-store", on: connection)
            return
        }
        let ext = fileURL.pathExtension.lowercased()
        let type: String
        switch ext {
        case "html": type = "text/html; charset=utf-8"
        case "js", "mjs": type = "application/javascript; charset=utf-8"
        case "css": type = "text/css; charset=utf-8"
        case "json", "webmanifest": type = "application/json"
        case "png": type = "image/png"
        case "svg": type = "image/svg+xml"
        case "ico": type = "image/x-icon"
        case "wav": type = "audio/wav"
        case "woff2": type = "font/woff2"
        case "txt": type = "text/plain; charset=utf-8"
        default: type = "application/octet-stream"
        }
        let cache = fileURL.path.contains("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
        send(status: 200, body: body, type: type, cache: cache, on: connection)
    }

    private func send(status: Int, body: Data, type: String, cache: String, on connection: NWConnection) {
        let reason = status == 200 ? "OK" : "Not Found"
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: \(cache)\r\nConnection: close\r\n\r\n"
        var out = Data(header.utf8)
        out.append(body)
        connection.send(content: out, completion: .contentProcessed { _ in connection.cancel() })
    }

    static func bundledWebRoot() -> URL? {
        let url = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)
        guard let url, FileManager.default.fileExists(atPath: url.appendingPathComponent("index.html").path) else {
            return nil
        }
        return url
    }
}
