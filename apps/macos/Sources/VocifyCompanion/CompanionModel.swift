import AppKit
import AVFoundation
import Foundation
import VocifyCore

@MainActor
final class CompanionModel: ObservableObject {
    enum Screen { case login, listen, review }

    @Published var screen: Screen = .login
    @Published var email = UserDefaults.standard.string(forKey: "vocify.email") ?? ""
    @Published var password = ""
    @Published var apiBase = UserDefaults.standard.string(forKey: "vocify.api") ?? LiveURL.prodAPI
    @Published var error = ""
    @Published var status = ""
    @Published var listening = false
    @Published var elapsed = "00:00"
    @Published var note = LiveNote()
    @Published var helpOn = false
    @Published var sayThis = ""
    @Published var checklist = ""
    @Published var summary = ""
    @Published var nextSteps = ""
    @Published var reviewStatus = ""
    @Published var busy = false

    private var token = UserDefaults.standard.string(forKey: "vocify.token") ?? ""
    private var finalText = ""
    private var interim = ""
    private var assist = AssistLine()
    private var speakerIsRep = false
    private let capture = MeetingCapture()
    private var socket: URLSessionWebSocketTask?
    private var started: Date?
    private var timer: Timer?
    private var memoId: String?

    init() {
        if !token.isEmpty { Task { await restoreSession() } }
        capture.onPCM = { [weak self] channel, pcm in
            Task { @MainActor in self?.sendAudio(channel: channel, pcm: pcm) }
        }
    }

    func restoreSession() async {
        guard !token.isEmpty else { screen = .login; return }
        do {
            try await VocifyAPI(base: apiBase, token: token).me()
            screen = .listen
        } catch {
            dropSession()
        }
    }

    func dropSession() {
        token = ""
        UserDefaults.standard.removeObject(forKey: "vocify.token")
        screen = .login
        error = "La sesión no vale. Entra otra vez."
    }

    func login() async {
        error = ""
        busy = true
        defer { busy = false }
        do {
            let api = VocifyAPI(base: apiBase, token: nil)
            let session = try await api.login(email: email.trimmingCharacters(in: .whitespaces), password: password)
            token = session.token
            UserDefaults.standard.set(token, forKey: "vocify.token")
            UserDefaults.standard.set(email, forKey: "vocify.email")
            UserDefaults.standard.set(LiveURL.apiBase(apiBase), forKey: "vocify.api")
            screen = .listen
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openPrivacy(_ pane: String) {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")
        if let url { NSWorkspace.shared.open(url) }
    }

    func toggleHelp() {
        helpOn.toggle()
        assist.helpOn = helpOn
        refreshSayThis()
        if helpOn { Task { await pullSuggest() } }
    }

    func startListen() async {
        error = ""
        let mic = AVCaptureDevice.authorizationStatus(for: .audio)
        if mic == .notDetermined {
            let allowed = await AVCaptureDevice.requestAccess(for: .audio)
            if !allowed {
                error = "Sin micrófono."
                openPrivacy("Privacy_Microphone")
                return
            }
        } else if mic != .authorized {
            error = "Sin micrófono."
            openPrivacy("Privacy_Microphone")
            return
        }
        if !CGPreflightScreenCaptureAccess() {
            if !CGRequestScreenCaptureAccess() {
                error = "Sin audio del sistema."
                openPrivacy("Privacy_ScreenCapture")
            }
        }
        guard let url = LiveURL.transcription(apiBase: apiBase) else {
            error = "URL de transcripción inválida"
            return
        }
        do {
            try capture.start()
        } catch {
            self.error = error.localizedDescription
            return
        }
        listening = true
        finalText = ""
        interim = ""
        note = LiveNote()
        started = Date()
        OverlayPanelController.shared.show(self)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.webSocketTask(with: request)
        socket = task
        task.resume()
        receiveLoop()
        Task { await capture.startSystemAudio() }
        status = "Escuchando."
    }

    func stopAndReview() async {
        capture.stop()
        OverlayPanelController.shared.hide()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        timer?.invalidate()
        listening = false
        let transcript = note.uploadText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else {
            return
        }
        busy = true
        defer { busy = false }
        do {
            let api = VocifyAPI(base: apiBase, token: token)
            let id = try await api.uploadTranscript(transcript)
            memoId = id
            screen = .review
            reviewStatus = ""
            let memo = try await waitMemo(api: api, id: id)
            let preview = try await api.preview(id)
            let extraction = memo["extraction"] as? [String: Any]
            summary = (extraction?["summary"] as? String) ?? ""
            if let steps = extraction?["nextSteps"] as? [String] {
                nextSteps = steps.joined(separator: "\n")
            }
            if summary.isEmpty, let text = preview["transcript_summary"] as? String {
                summary = text
            }
            reviewStatus = ""
        } catch {
            let message = error.localizedDescription
            if message.localizedCaseInsensitiveContains("session") || message.localizedCaseInsensitiveContains("sign in") {
                dropSession()
                return
            }
            self.error = message
            reviewStatus = ""
        }
    }

    func approve() async {
        guard let memoId else { return }
        busy = true
        defer { busy = false }
        let steps = nextSteps.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let body = ApproveBody(summary: summary, nextSteps: steps)
        do {
            try await VocifyAPI(base: apiBase, token: token).approve(memoId: memoId, body: body)
            reviewStatus = "CRM actualizado."
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() {
        capture.stop()
        OverlayPanelController.shared.hide()
        socket?.cancel(with: .goingAway, reason: nil)
        token = ""
        UserDefaults.standard.removeObject(forKey: "vocify.token")
        screen = .login
    }

    private func tick() {
        guard let started else { return }
        let total = Int(Date().timeIntervalSince(started))
        elapsed = String(format: "%02d:%02d", total / 60, total % 60)
        refreshSayThis()
        if listening { OverlayPanelController.shared.show(self) }
    }

    private func sendAudio(channel: String, pcm: Data) {
        guard listening, let socket else { return }
        speakerIsRep = channel == "rep"
        let frame = ChannelAudio.frame(channel: channel, pcm: pcm)
        socket.send(.string(frame)) { _ in }
    }

    private func receiveLoop() {
        socket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                if case .failure = result, self.listening {
                    self.error = "Se cortó."
                }
                if case .success(.string(let text)) = result,
                   let data = text.data(using: .utf8),
                   let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let parsed = ChannelAudio.transcriptText(from: event),
                   !parsed.text.isEmpty {
                    let speaker = ChannelAudio.speaker(from: event)
                    if speaker == "rep" || speaker == "prospect" {
                        self.speakerIsRep = speaker == "rep"
                    }
                    self.note.apply(text: parsed.text, isFinal: parsed.isFinal, speaker: speaker)
                    self.finalText = self.note.uploadText
                    self.refreshSayThis()
                    OverlayPanelController.shared.show(self)
                    if parsed.isFinal {
                        Task { await self.pullChecklist() }
                        if self.helpOn { Task { await self.pullSuggest() } }
                    }
                }
                if self.listening { self.receiveLoop() }
            }
        }
    }

    private func pullChecklist() async {
        guard let data = try? await VocifyAPI(base: apiBase, token: token).checklist() else { return }
        let observed = data["observed"] as? Int ?? 0
        let applicable = data["applicable"] as? Int ?? 0
        guard applicable > 0 else { checklist = ""; return }
        checklist = "\(observed) de \(applicable)"
        OverlayPanelController.shared.show(self)
    }

    private func pullSuggest() async {
        let latest = note.latestFinal
        guard !latest.isEmpty,
              let result = try? await VocifyAPI(base: apiBase, token: token).suggest(transcript: finalText, latest: latest)
        else { return }
        assist.helpOn = helpOn
        assist = assist.present(result.text, evidenceCount: result.evidence, playbookReady: result.playbookReady, now: Date())
        refreshSayThis()
    }

    private func refreshSayThis() {
        sayThis = assist.visible(now: Date(), speakerIsRep: speakerIsRep) ?? ""
    }

    private func waitMemo(api: VocifyAPI, id: String) async throws -> [String: Any] {
        let start = Date()
        while Date().timeIntervalSince(start) < 180 {
            let memo = try await api.memo(id)
            let status = ReviewGate.status(of: memo)
            if ReviewGate.isReady(status) { return memo }
            if ReviewGate.failed(status) {
                throw APIError.message((memo["errorMessage"] as? String) ?? "La extracción falló")
            }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        throw APIError.message("Tiempo de espera agotado")
    }
}
