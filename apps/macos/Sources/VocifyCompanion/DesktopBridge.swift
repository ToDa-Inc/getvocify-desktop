import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit
import WebKit

@MainActor
final class DesktopBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var mainWebView: WKWebView?
    weak var overlayWebView: WKWebView?

    private let capture = MeetingCapture()
    private var shellState: [String: Any] = [:]

    var isListening: Bool { shellState["listening"] as? Bool ?? false }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "vocify",
              let body = message.body as? [String: Any],
              let op = body["op"] as? String
        else {
            replyHandler(nil, "invalid message")
            return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            let result = await handle(op: op, args: args)
            replyHandler(Self.webKitSafe(result), nil)
        }
    }

    func handle(op: String, args: [String: Any]) async -> Any? {
        switch op {
        case "saas:request":
            let payload = args["payload"] as? [String: Any] ?? [:]
            return await SaasProxy.request(payload)
        case "system-audio:start":
            return await startSystemAudio()
        case "system-audio:stop":
            capture.stopSystemAudioOnly()
            return ["ok": true]
        case "permissions:status":
            return await permissionSnapshot()
        case "permissions:request":
            await requestPermission(type: args["type"] as? String)
            return await permissionSnapshot()
        case "permissions:open":
            openPermissionSettings(type: args["type"] as? String)
            return await permissionSnapshot()
        case "permissions:appInfo":
            return appInfo()
        case "shell:state":
            if let state = args["state"] as? [String: Any] {
                for (key, value) in state {
                    shellState[key] = value
                }
                pushOverlayState()
            }
            return nil
        case "shell:resize":
            return ["ok": true]
        case "shell:open-external":
            if let urlStr = args["url"] as? String,
               urlStr.range(of: #"^https?://"#, options: .regularExpression) != nil,
               let url = URL(string: urlStr) {
                NSWorkspace.shared.open(url)
            }
            return ["ok": true]
        case "shell:command":
            routeShellCommand(args["name"] as? String ?? "")
            return nil
        case "drafts:save":
            return ["ok": MeetingDrafts.save(args["draft"] as? [String: Any] ?? [:])]
        case "drafts:list":
            return MeetingDrafts.list()
        case "drafts:remove":
            MeetingDrafts.remove(id: args["id"])
            return ["ok": true]
        case "overlay:show":
            OverlayPanelController.shared.showWeb(bridge: self)
            return ["ok": true]
        case "overlay:hide":
            OverlayPanelController.shared.hide()
            return ["ok": true]
        default:
            return nil
        }
    }

    private func startSystemAudio() async -> [String: Any] {
        capture.stopSystemAudioOnly()
        capture.onPCM = { [weak self] channel, data in
            guard channel == "prospect" else { return }
            let encoded = data.base64EncodedString()
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, let webView = self.mainWebView else { return }
                    self.emit("system-audio:pcm", encoded, in: webView)
                }
            }
        }
        capture.onSystemAudioStopped = { [weak self] in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, let webView = self.mainWebView else { return }
                    self.emit("system-audio:lost", ["reason": "no_system_audio"], in: webView)
                }
            }
        }
        await capture.startSystemAudio()
        if capture.hasSystemStream {
            return ["ok": true, "backend": "screencapturekit"]
        }
        return ["ok": false, "reason": "no_system_audio"]
    }

    private func permissionSnapshot() async -> [String: String] {
        [
            "platform": "darwin",
            "microphone": microphoneAccessStatus(),
            "systemAudio": await systemAudioAccessStatus(),
        ]
    }

    private func microphoneAccessStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "authorized"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "never_requested"
        @unknown default: return "never_requested"
        }
    }

    private func systemAudioAccessStatus() async -> String {
        await SystemAudioPermission.status()
    }

    private func appInfo() -> [String: String] {
        let bundle = Bundle.main
        return [
            "name": bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
                ?? "Vocify",
            "bundleId": bundle.bundleIdentifier ?? "com.vocify.companion",
        ]
    }

    private func requestPermission(type: String?) async {
        switch type {
        case "microphone":
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        case "systemAudio":
            _ = CGRequestScreenCaptureAccess()
        default:
            break
        }
    }

    private func openPermissionSettings(type: String?) {
        let anchor = type == "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture"
        for raw in [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)",
            "x-apple.systempreferences:com.apple.preference.security?\(anchor)",
        ] {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) { break }
        }
    }

    private func routeShellCommand(_ name: String) {
        if name == "show" {
            showMainWindow()
        } else {
            emitCommand(name)
        }
    }

    func showMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        mainWebView?.window?.makeKeyAndOrderFront(nil)
    }

    func pushOverlayState() {
        guard let overlayWebView else { return }
        emit("overlay:state", shellState, in: overlayWebView)
    }

    func emitCommand(_ name: String) {
        guard let mainWebView else { return }
        emit("shell:command", name, in: mainWebView)
    }

    func emit(_ channel: String, _ payload: Any, in webView: WKWebView) {
        let channelJSON = Self.jsonLiteral(channel)
        let payloadJS = Self.jsonLiteral(forPayload: payload)
        webView.evaluateJavaScript("window.__vocifyEmit(\(channelJSON), \(payloadJS))")
    }

    nonisolated static func webKitSafe(_ value: Any?) -> Any {
        guard let value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let parsed = try? JSONSerialization.jsonObject(with: data) else {
            if value == nil { return NSNull() }
            return value is [String: Any] ? value! : [:]
        }
        return parsed
    }

    private static func jsonLiteral(_ text: String) -> String {
        guard let data = try? JSONEncoder().encode(text),
              let encoded = String(data: data, encoding: .utf8) else { return "\"\"" }
        return encoded
    }

    private static func jsonLiteral(forPayload payload: Any) -> String {
        if let text = payload as? String { return jsonLiteral(text) }
        let safe = webKitSafe(payload)
        guard JSONSerialization.isValidJSONObject(safe),
              let data = try? JSONSerialization.data(withJSONObject: safe),
              let json = String(data: data, encoding: .utf8) else { return "null" }
        return json
    }

    static func bridgeScriptSource() -> String? {
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let text = try? String(contentsOf: url, encoding: .utf8) {
            return text
        }
        let dev = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("bridge.js")
        return try? String(contentsOf: dev, encoding: .utf8)
    }
}
