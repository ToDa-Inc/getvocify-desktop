import AppKit
import AVFoundation
import Foundation
import os
import ScreenCaptureKit
import VocifyCore
import WebKit

@MainActor
final class DesktopBridge: NSObject, WKScriptMessageHandlerWithReply {
    /// The dashboard's uncaught errors: `log show --predicate 'subsystem == "com.vocify.app"'`.
    nonisolated static let webLog = Logger(subsystem: "com.vocify.app", category: "dashboard")
    /// Live help as it happens (each ask, draft, answer, card shown or dropped), for tests only:
    /// it carries the conversation's words, so it is off unless
    /// `defaults write com.vocify.app vocify.liveHelpLog -bool true`.
    /// Read: `log stream --predicate 'subsystem == "com.vocify.app" AND category == "live-help"'`.
    nonisolated static let helpLog = Logger(subsystem: "com.vocify.app", category: "live-help")
    static var helpLogOn: Bool { UserDefaults.standard.bool(forKey: "vocify.liveHelpLog") }
    weak var mainWebView: WKWebView?

    private let capture = MeetingCapture()
    private var shellState: [String: Any] = [:]
    /// The call being recorded natively, if any.
    private var recorder: NativeRecorder?

    var isListening: Bool { shellState["listening"] as? Bool ?? false }

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        Task { @MainActor in
            guard message.name == "vocify",
                  let body = message.body as? [String: Any],
                  let op = body["op"] as? String
            else {
                replyHandler(nil, "invalid message")
                return
            }
            let args = body["args"] as? [String: Any] ?? [:]
            let result = await handle(op: op, args: args)
            replyHandler(Self.webKitSafe(result), nil)
        }
    }

    func handle(op: String, args: [String: Any]) async -> Any? {
        switch op {
        case "log:event":
            guard Self.helpLogOn else { return nil }
            let name = args["name"] as? String ?? "event"
            let details = (args["details"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            Self.helpLog.info("\(name, privacy: .public) \(details, privacy: .public)")
            return nil
        case "log:error":
            let kind = args["kind"] as? String ?? "error"
            let path = args["path"] as? String ?? ""
            let text = args["text"] as? String ?? ""
            Self.webLog.error("dashboard \(kind, privacy: .public) at \(path, privacy: .public): \(text, privacy: .public)")
            return nil
        case "saas:request":
            let payload = args["payload"] as? [String: Any] ?? [:]
            return await SaasProxy.request(payload)
        case "system-audio:start":
            return await startSystemAudio()
        case "system-audio:stop":
            capture.stopSystemAudioOnly()
            return ["ok": true]
        case "shortcut:get":
            return shortcutSnapshot()
        case "shortcut:set":
            let result = RecordShortcut.shared.set(
                code: args["code"] as? String ?? "",
                command: args["meta"] as? Bool ?? false,
                option: args["alt"] as? Bool ?? false,
                control: args["ctrl"] as? Bool ?? false,
                shift: args["shift"] as? Bool ?? false
            )
            switch result {
            case .ok: return shortcutSnapshot().merging(["ok": true]) { $1 }
            case .invalid: return shortcutSnapshot().merging(["ok": false, "reason": "invalid"]) { $1 }
            case .taken: return shortcutSnapshot().merging(["ok": false, "reason": "taken"]) { $1 }
            }
        case "shortcut:clear":
            RecordShortcut.shared.clear()
            return shortcutSnapshot()
        case "recorder:start":
            return await startRecorder(url: args["url"] as? String, ticket: args["ticket"] as? String)
        case "recorder:pause":
            recorder?.setPaused(args["paused"] as? Bool ?? false)
            return ["ok": true]
        case "recorder:stop":
            guard let active = recorder else { return ["transcript": NSNull()] }
            recorder = nil
            let transcript = await active.stop()
            MeetingPillController.shared.state.nativeTranscript = false
            return ["transcript": transcript]
        case "permissions:status":
            return permissionSnapshot()
        case "permissions:request":
            await requestPermission(type: args["type"] as? String)
            return permissionSnapshot()
        case "permissions:open", "permissions:guide":
            await presentPermissionGuide(type: args["type"] as? String)
            return permissionSnapshot()
        case "permissions:appInfo":
            return appInfo()
        case "shell:relaunch":
            relaunch()
            return ["ok": true]
        case "shell:state":
            if let state = args["state"] as? [String: Any] {
                for (key, value) in state {
                    shellState[key] = value
                }
                // Only what changed: level pushes arrive ~10×/s and must not re-parse the transcript.
                MeetingPillController.shared.state.apply(state)
            }
            return nil
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
            MeetingPillController.shared.show(bridge: self)
            return ["ok": true]
        case "overlay:hide":
            MeetingPillController.shared.hide()
            return ["ok": true]
        case "crm:pages":
            return await CrmPageReader.read(ask: args["ask"] as? Bool ?? true).result
        case "crm:open-automation-settings":
            NSWorkspace.shared.open(CrmPageReader.automationSettingsURL)
            return ["ok": true]
        default:
            return nil
        }
    }

    private func shortcutSnapshot() -> [String: Any] {
        ["label": RecordShortcut.shared.combo?.label ?? NSNull(), "defaultLabel": RecordShortcut.defaultCombo.label]
    }

    /// Records the call in the Mac app: mic, call audio and transcription socket, no web audio.
    private func startRecorder(url raw: String?, ticket: String?) async -> [String: Any] {
        guard recorder == nil else { return ["ok": false, "reason": "already_recording"] }
        guard let raw, let url = URL(string: raw), ["ws", "wss"].contains(url.scheme ?? ""),
              url.path.hasSuffix("/transcription/live") else {
            return ["ok": false, "reason": "bad_url"]
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            return ["ok": false, "reason": "no_microphone"]
        }
        capture.stopSystemAudioOnly()
        let emitTo: (String, Any) -> Void = { [weak self] channel, payload in
            guard let self, let webView = self.mainWebView else { return }
            self.emit(channel, payload, in: webView)
        }
        let recorder = NativeRecorder(
            url: Self.liveServer(url),
            ticket: ticket,
            callApp: MeetingPillController.shared.callAppBundleID,
            capture: capture,
            events: .init(
                transcript: { json in MainActor.assumeIsolated { emitTo("recorder:transcript", json) } },
                levels: { you, them in MainActor.assumeIsolated { emitTo("recorder:levels", ["you": you, "them": them]) } },
                warning: { text in MainActor.assumeIsolated { emitTo("recorder:warning", ["text": (text as Any?) ?? NSNull()]) } },
                callAudioLost: { MainActor.assumeIsolated { emitTo("system-audio:lost", ["reason": "no_system_audio"]) } }
            )
        )
        MeetingPillController.shared.state.nativeTranscript = true
        do {
            try await recorder.start()
        } catch NativeRecorder.RecorderError.noSystemAudio {
            MeetingPillController.shared.state.nativeTranscript = false
            let reason = SystemAudioPermission.probe().preflight ? "needs_restart" : "no_system_audio"
            return ["ok": false, "reason": reason]
        } catch {
            MeetingPillController.shared.state.nativeTranscript = false
            return ["ok": false, "reason": "no_microphone"]
        }
        self.recorder = recorder
        return ["ok": true]
    }

    /// `defaults write com.vocify.app vocify.liveServer api` sends calls to the API instead
    /// of the live service, to compare the two; each call's report says which one served it.
    private static func liveServer(_ url: URL) -> URL {
        guard UserDefaults.standard.string(forKey: "vocify.liveServer") == "api",
              let raw = Bundle.main.object(forInfoDictionaryKey: "VocifyAPIURL") as? String,
              let api = URL(string: raw),
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.scheme = api.scheme == "https" ? "wss" : "ws"
        parts.host = api.host
        parts.port = api.port
        return parts.url ?? url
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
        let reason = SystemAudioPermission.probe().preflight ? "needs_restart" : "no_system_audio"
        return ["ok": false, "reason": reason]
    }

    private func permissionSnapshot() -> [String: Any] {
        let signing = AppSigning.info()
        let audio = SystemAudioPermission.probe()
        return [
            "platform": "darwin",
            "microphone": microphoneAccessStatus(),
            "systemAudio": audio.status,
            "signing": signing.isAdHoc ? "adhoc" : "signed",
            "signingAuthority": signing.authority ?? "",
            "systemAudioError": audio.lastError ?? "",
            "screenCapturePreflight": audio.preflight,
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

    private func appInfo() -> [String: String] {
        let bundle = Bundle.main
        return [
            "name": bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
                ?? "Vocify",
            "bundleId": bundle.bundleIdentifier ?? "com.vocify.app",
        ]
    }

    /// Screen & System Audio Recording only applies after a restart. Reopens this exact copy once
    /// it has quit; "Quit & Reopen" in Settings goes by bundle ID and can open another copy.
    private func relaunch() {
        let reopen = Process()
        reopen.executableURL = URL(fileURLWithPath: "/bin/sh")
        reopen.arguments = [
            "-c",
            "while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done; /usr/bin/open \"$0\"",
            Bundle.main.bundlePath,
        ]
        do {
            try reopen.run()
        } catch {
            return
        }
        NSApp.terminate(nil)
    }

    private func requestPermission(type: String?) async {
        await presentPermissionGuide(type: type)
        emitPermissionsChanged()
    }

    private func presentPermissionGuide(type: String?) async {
        let kind: PermissionGuideController.Kind = type == "microphone" ? .microphone : .systemAudio
        await PermissionGuideController.shared.present(kind, bridge: self)
    }

    func emitPermissionsChanged() {
        guard let mainWebView else { return }
        emit("permissions:changed", [:], in: mainWebView)
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

    func emitCommand(_ name: String) {
        guard let mainWebView else { return }
        emit("shell:command", name, in: mainWebView)
    }

    /// A call started with these CRM pages on screen; the dashboard names the contact
    /// (POST /live-calls/preview) and sends it back as `shell:state` callContact.
    func emitCallPages(_ urls: [String]) {
        guard let mainWebView else { return }
        emit("call:pages", ["urls": urls], in: mainWebView)
    }

    /// The call type the rep chose in the island while recording; nil hands it back to Vocify.
    func emitCallType(_ key: String?) {
        guard let mainWebView else { return }
        emit("call:type", ["key": (key as Any?) ?? NSNull()], in: mainWebView)
    }

    /// Where the call happens (app or page) and whether that makes it a call or a meeting.
    func emitCallSource(_ source: CallSource?) {
        guard let mainWebView else { return }
        emit("call:source", source?.json ?? NSNull(), in: mainWebView)
    }

    /// A choice made in the island's post-call card, e.g. ["type": "approve", "omit": [...]].
    func emitPostCallAction(_ action: [String: Any]) {
        guard let mainWebView else { return }
        emit("postcall:action", action, in: mainWebView)
    }

    /// The detected call ended: its contact must not carry over to the next recording.
    func emitCallEnded() {
        guard let mainWebView else { return }
        emit("call:ended", [:], in: mainWebView)
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
