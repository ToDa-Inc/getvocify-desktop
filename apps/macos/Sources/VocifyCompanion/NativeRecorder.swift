import AVFoundation
import Foundation
import VocifyCore

/// Records a call natively: the mic (echo-cancelled) and the call's audio go straight from
/// the Mac to the transcription socket, the transcript is built here and drawn by the island,
/// and the dashboard gets a copy for its own view, the saved draft and the upload. Nothing on
/// this path waits on the web page, so a hidden or busy dashboard can't slow the call down.
///
/// Audio and socket state live on `queue`; the transcript and the island on the main actor.
final class NativeRecorder: @unchecked Sendable {
    struct Events {
        /// The dashboard's MeetingTranscript JSON, at most every `snapshotEvery`.
        var transcript: ([String: Any]) -> Void
        var levels: (_ you: Double, _ them: Double) -> Void
        /// nil clears it.
        var warning: (String?) -> Void
        var callAudioLost: () -> Void
    }

    private static let chunkBytes = 3200 // 100 ms of 16 kHz s16le
    private static let bytesPerSecond = 32000.0
    private static let maxReconnects = 5
    private static let drainTimeout: TimeInterval = 6
    /// Audio kept while the socket reconnects, then sent at once (the server takes it faster than real time).
    private static let maxBacklogBytes = 30 * 32000
    /// The dashboard's copy (its view, the draft, the upload): it's usually hidden during a
    /// call, and the copy grows with the call, so once a second is plenty.
    private static let snapshotEvery: TimeInterval = 1
    /// The island's voice wave wants ~12 levels a second; the dashboard's meter far fewer.
    private static let pageLevelsEvery: TimeInterval = 0.25
    /// A side further behind the wall clock than this gets silence: the call's audio starts
    /// later than the mic and macOS sends nothing while the call is quiet, and both sides must
    /// stay on one clock or the mic's echo of the call can't be told apart from the rep.
    private static let maxClockSlip: TimeInterval = 0.3
    /// Keeps a quiet call's socket alive and notices a dead one.
    private static let pingEvery: TimeInterval = 10

    private let url: URL
    /// The live service's pass, sent first on every connection (it trusts nothing in the URL).
    private let ticket: String?
    /// The call app being recorded, for reading who speaks on its screen.
    private let callApp: String?
    private let capture: MeetingCapture
    private let mic = MicCapture()
    private let events: Events
    private let queue = DispatchQueue(label: "vocify.recorder")

    // queue
    private var socket: URLSessionWebSocketTask?
    private var open = false
    private var stopping = false
    private var paused = false
    private var reconnects = 0
    private var pending: [String: Data] = [:]
    private var backlog: [(channel: String, frame: String, bytes: Int)] = []
    private var backlogBytes = 0
    /// Seconds of each side sent on earlier sockets: a new socket's clock starts at zero.
    private var offset: [String: Double] = [:]
    private var sentOnSocket: [String: Int] = [:]
    private var level: [String: Double] = ["rep": 0, "prospect": 0]
    /// When recording began, and how much audio each side has had since, in bytes.
    private var startedAt = Date()
    private var taken: [String: Int] = [:]
    private var pinger: DispatchSourceTimer?
    /// Pauses in a call can be long: nothing must time out while nobody speaks.
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 24 * 3600
        config.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: config)
    }()
    /// Keeps macOS from throttling Vocify (App Nap) or sleeping while the call is recorded.
    @MainActor private var activity: NSObjectProtocol?
    /// Who the call app showed speaking, on the recording's clock.
    @MainActor private var speakers = SpeakerTimeline()
    private var speakerTimer: DispatchSourceTimer?
    private let speakerQueue = DispatchQueue(label: "vocify.recorder.speakers", qos: .utility)
    private static let speakerEvery: TimeInterval = 0.4
    private var levelsSentAt = Date.distantPast
    private var pageLevelsSentAt = Date.distantPast
    private var drained: (() -> Void)?

    // main
    @MainActor private var transcript = LiveTranscript()
    @MainActor private var snapshotScheduled = false

    init(url: URL, ticket: String?, callApp: String?, capture: MeetingCapture, events: Events) {
        self.url = url
        self.ticket = ticket
        self.callApp = callApp
        self.capture = capture
        self.events = events
    }

    /// Starts the mic and the call's audio; the socket opens alongside.
    @MainActor
    func start() async throws {
        MeetingPillController.shared.state.turns = []
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled, .latencyCritical],
            reason: "Recording a call"
        )
        let begun = Date()
        queue.sync { startedAt = begun }
        mic.onPCM = { [weak self] pcm in self?.queue.async { self?.take("rep", pcm) } }
        try mic.start()
        capture.onPCM = { [weak self] channel, pcm in
            guard channel == "prospect" else { return }
            self?.queue.async { self?.take("prospect", pcm) }
        }
        capture.onSystemAudioStopped = { [weak self] in
            DispatchQueue.main.async { self?.events.callAudioLost() }
        }
        await capture.startSystemAudio()
        guard capture.hasSystemStream else {
            mic.stop()
            capture.stopSystemAudioOnly()
            endActivity()
            throw RecorderError.noSystemAudio
        }
        queue.async {
            self.connect()
            self.startPinging()
        }
        watchSpeakers()
    }

    func setPaused(_ value: Bool) {
        queue.async { self.paused = value }
    }

    /// Finishes the transcript (the last finals arrive before EndOfTranscript) and returns it.
    @MainActor
    func stop() async -> [String: Any] {
        mic.stop()
        capture.stopSystemAudioOnly()
        capture.onPCM = nil
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            queue.async {
                self.stopping = true
                self.flushPending()
                guard self.open, let socket = self.socket else {
                    done.resume()
                    return
                }
                var resumed = false
                let finish = {
                    guard !resumed else { return }
                    resumed = true
                    self.drained = nil
                    done.resume()
                }
                self.drained = finish
                socket.send(.string(#"{"type":"CloseStream"}"#)) { _ in }
                self.queue.asyncAfter(deadline: .now() + Self.drainTimeout, execute: finish)
            }
        }
        queue.sync {
            pinger?.cancel()
            pinger = nil
            socket?.cancel(with: .normalClosure, reason: nil)
            socket = nil
            open = false
        }
        endActivity()
        speakerTimer?.cancel()
        speakerTimer = nil
        return transcript.json()
    }

    /// Reads who the call app shows speaking a few times a second, when it's an app we can read.
    @MainActor
    private func watchSpeakers() {
        guard ActiveSpeakers.supports(callApp) else { return }
        let asked = "vocify.askedAccessibility"
        let trusted = ActiveSpeakers.ensureTrusted(prompt: !UserDefaults.standard.bool(forKey: asked))
        UserDefaults.standard.set(true, forKey: asked)
        guard trusted else { return }
        let app = callApp
        let begun = queue.sync { startedAt }
        let timer = DispatchSource.makeTimerSource(queue: speakerQueue)
        timer.schedule(deadline: .now(), repeating: Self.speakerEvery)
        timer.setEventHandler { [weak self] in
            guard let names = ActiveSpeakers.read(bundleID: app) else { return }
            let at = Date().timeIntervalSince(begun)
            DispatchQueue.main.async { self?.speakers.record(at: at, speaking: names) }
        }
        timer.resume()
        speakerTimer = timer
    }

    @MainActor
    private func endActivity() {
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        activity = nil
    }

    // MARK: Audio → socket (queue)

    private func take(_ channel: String, _ pcm: Data) {
        guard !stopping else { return }
        // Paused: silence keeps the session open and both sides on one clock.
        let audio = paused ? Data(count: pcm.count) : pcm
        level[channel] = max((level[channel] ?? 0) * 0.85, paused ? 0 : Self.loudness(pcm))
        let now = Date()
        if now.timeIntervalSince(levelsSentAt) > 0.08 {
            levelsSentAt = now
            let you = level["rep"] ?? 0, them = level["prospect"] ?? 0
            let toPage = now.timeIntervalSince(pageLevelsSentAt) > Self.pageLevelsEvery
            if toPage { pageLevelsSentAt = now }
            DispatchQueue.main.async {
                MeetingPillController.shared.state.levels.update(you: you, them: them)
                if toPage { self.events.levels(you, them) }
            }
        }
        var buffer = pending[channel] ?? Data()
        // Behind the wall clock (late start, quiet call): fill the gap with silence first.
        let behind = now.timeIntervalSince(startedAt) - Double(pcm.count) / Self.bytesPerSecond
            - Double(taken[channel] ?? 0) / Self.bytesPerSecond
        if behind > Self.maxClockSlip {
            let gap = Int(behind * Self.bytesPerSecond) & ~1
            buffer.append(Data(count: gap))
            taken[channel, default: 0] += gap
        }
        taken[channel, default: 0] += audio.count
        buffer.append(audio)
        while buffer.count >= Self.chunkBytes {
            send(channel, buffer.prefix(Self.chunkBytes))
            buffer.removeFirst(Self.chunkBytes)
        }
        pending[channel] = buffer
    }

    private func flushPending() {
        for (channel, buffer) in pending where !buffer.isEmpty {
            send(channel, buffer)
        }
        pending = [:]
    }

    private func send(_ channel: String, _ pcm: Data) {
        let frame = ChannelAudio.frame(channel: channel, pcm: Data(pcm))
        guard open, let socket else {
            // Reconnecting: keep the newest audio, the server catches up when it's back.
            backlog.append((channel, frame, pcm.count))
            backlogBytes += pcm.count
            while backlogBytes > Self.maxBacklogBytes, !backlog.isEmpty {
                backlogBytes -= backlog.removeFirst().bytes
            }
            return
        }
        sentOnSocket[channel, default: 0] += pcm.count
        socket.send(.string(frame)) { _ in }
    }

    private func startPinging() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + Self.pingEvery, repeating: Self.pingEvery)
        timer.setEventHandler { [weak self] in
            guard let self, self.open, let socket = self.socket else { return }
            socket.sendPing { error in
                guard error != nil else { return }
                self.queue.async {
                    if socket === self.socket, self.open { self.dropped(socket) }
                }
            }
        }
        timer.resume()
        pinger = timer
    }

    private func connect() {
        let socket = session.webSocketTask(with: url)
        self.socket = socket
        open = false
        socket.resume()
        if let ticket, let auth = try? JSONSerialization.data(withJSONObject: ["type": "Auth", "ticket": ticket]),
           let text = String(data: auth, encoding: .utf8) {
            socket.send(.string(text)) { _ in }
        }
        receive(on: socket)
    }

    private func receive(on socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard socket === self.socket else { return }
                switch result {
                case .failure:
                    self.dropped(socket)
                case .success(let message):
                    if case .string(let text) = message,
                       let data = text.data(using: .utf8),
                       let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        self.handle(event)
                    }
                    self.receive(on: socket)
                }
            }
        }
    }

    private func handle(_ event: [String: Any]) {
        switch event["type"] as? String {
        case "connected":
            open = true
            reconnects = 0
            sentOnSocket = [:]
            let waiting = backlog
            backlog = []
            backlogBytes = 0
            for item in waiting {
                sentOnSocket[item.channel, default: 0] += item.bytes
                socket?.send(.string(item.frame)) { _ in }
            }
            DispatchQueue.main.async { self.events.warning(nil) }
        case "Results":
            let channel = event["audio_channel"] as? String
            let shift = channel.flatMap { offset[$0] } ?? 0
            let text = ((event["channel"] as? [String: Any])?["alternatives"] as? [[String: Any]])?.first?["transcript"] as? String ?? ""
            let isFinal = event["is_final"] as? Bool ?? false
            let start = (event["start"] as? Double).map { $0 + shift }
            let end = (event["end"] as? Double).map { $0 + shift }
            DispatchQueue.main.async {
                // The other side's words go to whoever the call app showed speaking then.
                let name = channel == "prospect" && !self.speakers.isEmpty
                    ? start.map { self.speakers.name(from: $0, to: end ?? $0) } ?? nil
                    : nil
                self.update { $0.apply(text: text, isFinal: isFinal, channel: channel, start: start, end: end, name: name) }
            }
        case "ChannelReset":
            let channel = event["audio_channel"] as? String
            let shift = channel.flatMap { offset[$0] } ?? 0
            let from = (event["from"] as? Double).map { $0 + shift }
            DispatchQueue.main.async {
                self.update { $0.reset(channel: channel, from: from) }
            }
        case "Error":
            let message = event["error"] as? String ?? "Transcription error"
            DispatchQueue.main.async { self.events.warning(message) }
        case "EndOfTranscript":
            drained?()
        default:
            break
        }
    }

    private func dropped(_ socket: URLSessionWebSocketTask) {
        open = false
        // Close it for good, so the server ends that session instead of transcribing nothing.
        socket.cancel(with: .goingAway, reason: nil)
        if stopping {
            drained?()
            return
        }
        for (channel, bytes) in sentOnSocket {
            offset[channel, default: 0] += Double(bytes) / Self.bytesPerSecond
        }
        sentOnSocket = [:]
        guard reconnects < Self.maxReconnects else {
            DispatchQueue.main.async { self.events.warning("Transcription disconnected. Saving what was captured.") }
            return
        }
        reconnects += 1
        DispatchQueue.main.async { self.events.warning("Reconnecting…") }
        queue.asyncAfter(deadline: .now() + Double(reconnects)) {
            guard !self.stopping, self.socket === socket else { return }
            self.connect()
        }
    }

    // MARK: Transcript (main)

    @MainActor
    private func update(_ change: (inout LiveTranscript) -> Bool) {
        guard change(&transcript) else { return }
        MeetingPillController.shared.state.showLive(transcript.rows())
        guard !snapshotScheduled else { return }
        snapshotScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.snapshotEvery) {
            self.snapshotScheduled = false
            self.events.transcript(self.transcript.json())
        }
    }

    // MARK: Helpers

    /// Loudness of one chunk, eased so normal speech sits around 0.5 (same curve as the dashboard).
    private static func loudness(_ pcm: Data) -> Double {
        pcm.withUnsafeBytes { raw -> Double in
            let samples = raw.bindMemory(to: Int16.self)
            guard !samples.isEmpty else { return 0 }
            var sum = 0.0
            var count = 0
            var i = 0
            while i < samples.count {
                let v = Double(samples[i]) / 32768
                sum += v * v
                count += 1
                i += 8
            }
            return min(1, ((sum / Double(count)).squareRoot() * 6).squareRoot())
        }
    }

    enum RecorderError: LocalizedError {
        case noSystemAudio
        var errorDescription: String? { "System audio could not start." }
    }
}

/// The mic, plain. Apple's voice processing (echo cancellation) measured a level of exactly 0
/// for a whole test recording, so it is not trusted with the rep's voice; the call heard
/// through the speakers is removed by the transcript's echo filter instead. One converter
/// for the whole call keeps the 16 kHz resampling continuous across buffers.
final class MicCapture: @unchecked Sendable {
    var onPCM: ((Data) -> Void)?
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, let converter = AVAudioConverter(from: format, to: target) else {
            throw MicError.noInput
        }
        converter.downmix = true
        self.converter = converter
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let pcm = self.convert(buffer) else { return }
            self.onPCM?(pcm)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> Data? {
        guard let converter else { return nil }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        var given = false
        var error: NSError?
        // `.noDataNow` (not end of stream) keeps the resampler's state for the next buffer.
        converter.convert(to: out, error: &error) { _, status in
            if given {
                status.pointee = .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return nil }
        return Data(bytes: samples, count: Int(out.frameLength) * MemoryLayout<Int16>.size)
    }

    enum MicError: LocalizedError {
        case noInput
        var errorDescription: String? { "Could not open the microphone." }
    }
}
