import AppKit
import SwiftUI

/// What the dashboard streams to the notch island through `shell:state`.
@MainActor
final class MeetingPillState: ObservableObject {
    struct Turn: Identifiable, Equatable {
        let id: String
        let you: Bool
        let label: String?
        let text: String
        let pending: String
    }

    /// Meeting time is kept here, not streamed: the web view's timers stall while Vocify is behind the call.
    struct Clock: Equatable {
        let startedAt: Date
        let paused: TimeInterval
        let pausedAt: Date?

        func elapsed(at now: Date) -> TimeInterval {
            max(0, (pausedAt ?? now).timeIntervalSince(startedAt) - paused)
        }

        /// Ticks land on whole seconds of meeting time, so no second is skipped or shown twice.
        var tickOrigin: Date { startedAt.addingTimeInterval(paused) }
    }

    struct Assist: Equatable {
        let label: String
        let isQuestion: Bool
        /** True while the answer is still being written: only the bridge line is known. */
        let drafting: Bool
        let bridge: String
        let sayThis: String
        let thenAsk: String
    }

    struct Countdown: Equatable {
        let total: TimeInterval
        var remaining: TimeInterval
        /// nil while the pointer holds it open.
        var runningSince: Date?

        func fraction(at now: Date) -> Double {
            let left = remaining - (runningSince.map { now.timeIntervalSince($0) } ?? 0)
            return max(0, min(1, left / total))
        }
    }

    enum Mode: Equatable {
        /// Always there: the Vocify mark beside the camera; click it to record.
        case idle
        /// Another app holds the mic: offer to record, record nothing yet.
        case call(MicActivityMonitor.Caller)
        case starting
        case recording
        /// The call is over: its memo is being written, then its CRM update is one click away.
        case postCall
    }

    /// What the dashboard says about the memo of the call that just ended.
    struct PostCall: Equatable {
        enum Stage: String {
            case writing, ready, approving, done, review
        }

        struct Update: Equatable, Identifiable {
            let label: String
            let value: String
            var id: String { label + value }
        }

        let stage: Stage
        let memoId: String
        let contactName: String?
        let updates: [Update]
        let total: Int
        let canApprove: Bool
        let note: String?

        init?(_ raw: [String: Any]) {
            guard let stage = (raw["stage"] as? String).flatMap(Stage.init(rawValue:)),
                  let memoId = raw["memoId"] as? String else { return nil }
            self.stage = stage
            self.memoId = memoId
            contactName = (raw["contactName"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            updates = (raw["updates"] as? [[String: Any]] ?? []).compactMap { item in
                guard let label = item["label"] as? String, let value = item["value"] as? String else { return nil }
                return Update(label: label, value: value)
            }
            total = (raw["total"] as? Int) ?? updates.count
            canApprove = raw["canApprove"] as? Bool ?? false
            note = (raw["note"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        }
    }

    @Published var mode: Mode = .idle
    /// The dashboard has someone signed in to record for.
    @Published var recorderReady = false
    @Published var postCall: PostCall?
    /// Lets the controller move the island when the memo's state changes.
    var onPostCallChange: (() -> Void)?
    /// Who the detected call is with, when the tab on screen is a CRM contact.
    @Published var callContact: String?
    /// A dropdown that folds itself away; the line under it shows the time left.
    @Published var countdown: Countdown?
    @Published var geometry = IslandGeometry.measure(IslandGeometry.screen())
    @Published var expanded = false
    @Published var clock: Clock?
    @Published var paused = false
    @Published var turns: [Turn] = []
    @Published var assist: Assist?
    /// The last answer after it retires, so help fades to "Earlier" instead of vanishing.
    @Published var lastHelp: Assist?
    /// Read by the meters on their own timeline; publishing at audio rate would redraw the transcript.
    let levels = LevelStore()

    func size(for mode: Mode, open: Bool) -> CGSize {
        geometry.size(mode, open: open, postCallBody: postCallBodyHeight)
    }

    /// Name row, up to three changes, then the actions; "done" is just the name row.
    private var postCallBodyHeight: CGFloat {
        guard let postCall else { return 44 }
        switch postCall.stage {
        case .done, .writing: return 46
        case .ready, .approving, .review:
            let lines = CGFloat(min(postCall.updates.count, 3))
            return 84 + lines * 22
        }
    }

    /// Applies one `shell:state` update; keys that are absent keep their value.
    func apply(_ state: [String: Any]) {
        if let paused = state["paused"] as? Bool, paused != self.paused { self.paused = paused }
        if let ready = state["recorderReady"] as? Bool, ready != recorderReady { recorderReady = ready }
        if state.keys.contains("postCall") {
            let next = (state["postCall"] as? [String: Any]).flatMap(PostCall.init)
            if next != postCall {
                postCall = next
                onPostCallChange?()
            }
        }
        if state.keys.contains("callContact") {
            let name = ((state["callContact"] as? [String: Any])?["name"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let next = name?.isEmpty == false ? name : nil
            if next != callContact { callContact = next }
        }
        if let raw = state["clock"] as? [String: Any], let started = raw["startedAt"] as? Double {
            let next = Clock(
                startedAt: Date(timeIntervalSince1970: started / 1000),
                paused: (raw["pausedMs"] as? Double ?? 0) / 1000,
                pausedAt: (raw["pausedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
            )
            if next != clock { clock = next }
        }
        if let raw = state["levels"] as? [String: Any] {
            levels.update(you: raw["you"] as? Double ?? 0, them: raw["them"] as? Double ?? 0)
        }
        if state.keys.contains("assist") {
            let raw = state["assist"] as? [String: Any]
            let next = raw.flatMap { raw -> Assist? in
                let drafting = (raw["stage"] as? String) == "draft"
                let say = raw["sayThis"] as? String ?? ""
                let bridge = raw["bridge"] as? String ?? ""
                guard drafting ? !bridge.isEmpty : !say.isEmpty else { return nil }
                return Assist(
                    label: raw["label"] as? String ?? "",
                    isQuestion: (raw["kind"] as? String) == "question",
                    drafting: drafting,
                    bridge: bridge,
                    sayThis: say,
                    thenAsk: raw["thenAsk"] as? String ?? ""
                )
            }
            if next != assist {
                if let current = assist, !current.drafting, next == nil { lastHelp = current }
                assist = next
            }
        }
        if let overlay = state["overlay"] as? [String: Any] {
            let next = (overlay["turns"] as? [[String: Any]] ?? []).enumerated().map { index, raw in
                Turn(
                    id: raw["key"] as? String ?? "row-\(index)",
                    you: raw["you"] as? Bool ?? false,
                    label: raw["label"] as? String,
                    text: raw["text"] as? String ?? "",
                    pending: raw["pending"] as? String ?? ""
                )
            }
            if next != turns { turns = next }
        }
    }
}

/// Latest loudness per side. A side that stops sending (silence) fades out on its own.
final class LevelStore {
    private var you: (value: Double, at: Date) = (0, .distantPast)
    private var them: (value: Double, at: Date) = (0, .distantPast)
    private static let fade: TimeInterval = 0.5

    func update(you: Double, them: Double) {
        let now = Date()
        if you != self.you.value { self.you = (you, now) }
        if them != self.them.value { self.them = (them, now) }
    }

    func value(you side: Bool, at now: Date) -> Double {
        let level = side ? you : them
        return level.value * max(0, 1 - now.timeIntervalSince(level.at) / Self.fade)
    }
}

/// Where the island sits: around the camera housing, or under the menu bar on screens without one.
struct IslandGeometry: Equatable {
    static let ear: CGFloat = 82
    /// Just room for the mark, so the idle island barely widens the camera housing.
    static let idleEar: CGFloat = 36

    var notchWidth: CGFloat
    var barHeight: CGFloat
    var screenHeight: CGFloat

    private var gap: CGFloat { max(notchWidth, 12) }

    /// Room for an app icon or a small record dot, no more.
    static let callEar: CGFloat = 46

    func earWidth(_ mode: MeetingPillState.Mode, open: Bool) -> CGFloat {
        guard !open else { return Self.ear }
        switch mode {
        case .idle: return Self.idleEar
        case .call, .postCall: return Self.callEar
        default: return Self.ear
        }
    }

    func size(_ mode: MeetingPillState.Mode, open: Bool, postCallBody: CGFloat = 44) -> CGSize {
        let closed = CGSize(width: gap + earWidth(mode, open: false) * 2, height: barHeight)
        switch mode {
        case .idle:
            return open ? CGSize(width: max(gap + Self.ear * 2, 380), height: barHeight + 56) : closed
        case .recording:
            return open ? CGSize(width: max(gap + Self.ear * 2, 460), height: min(400, (screenHeight * 0.5).rounded())) : closed
        case .call:
            return open ? CGSize(width: max(gap + Self.ear * 2, 380), height: barHeight + 56) : closed
        case .postCall:
            return open ? CGSize(width: max(gap + Self.ear * 2, 400), height: barHeight + postCallBody) : closed
        case .starting:
            return closed
        }
    }

    /// The built-in display when it has a notch, otherwise the screen with the menu bar.
    static func screen() -> NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
    }

    static func measure(_ screen: NSScreen?) -> IslandGeometry {
        guard let screen else { return IslandGeometry(notchWidth: 0, barHeight: 30, screenHeight: 800) }
        let menuBar = screen.frame.maxY - screen.visibleFrame.maxY
        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea,
           let right = screen.auxiliaryTopRightArea {
            return IslandGeometry(
                notchWidth: screen.frame.width - left.width - right.width,
                barHeight: screen.safeAreaInsets.top,
                screenHeight: screen.frame.height
            )
        }
        return IslandGeometry(notchWidth: 0, barHeight: max(menuBar, 30), screenHeight: screen.frame.height)
    }
}

/// Clickable on the first click without activating Vocify, so the call keeps focus.
private final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
final class MeetingPillController {
    static let shared = MeetingPillController()

    let state = MeetingPillState()
    private var panel: NSPanel?
    private weak var bridge: DesktopBridge?
    private let calls = MicActivityMonitor()
    /// Set by a recording or a dismiss; cleared once the mic goes quiet, i.e. the call ended.
    private var callHandled = false
    private var startTimeout: Task<Void, Never>?
    private var autoClose: Task<Void, Never>?
    private var hangUp: Task<Void, Never>?
    /// The call app being recorded; its letting go of the mic is the hang-up.
    private var recordingCaller: MicActivityMonitor.Caller?
    /// The call app holding the mic right now, as last reported.
    private var currentCaller: MicActivityMonitor.Caller?
    private static let idleLinger: TimeInterval = 5
    private static let callLinger: TimeInterval = 8
    private static let postCallLinger: TimeInterval = 14
    private static let doneLinger: TimeInterval = 3
    /// A call app can drop the mic for a moment (device switch); a hang-up lasts.
    private static let hangUpGrace: TimeInterval = 3
    private var screenObserver: NSObjectProtocol?

    /// Offers to record when a call starts. Called once the dashboard can receive commands.
    func watchCalls(bridge: DesktopBridge) {
        self.bridge = bridge
        calls.onCall = { [weak self] caller in self?.callChanged(caller) }
        calls.start()
        state.onPostCallChange = { [weak self] in self?.postCallChanged() }
        transition(to: .idle, expanded: false)
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let controller = self else { return }
            MainActor.assumeIsolated { controller.remeasure() }
        }
    }

    func show(bridge: DesktopBridge) {
        self.bridge = bridge
        callHandled = true
        startTimeout?.cancel()
        if case .call(let caller) = state.mode {
            recordingCaller = caller
        } else if state.mode != .recording {
            recordingCaller = currentCaller
        }
        calls.ignoresWebKit = true
        transition(to: .recording, expanded: state.mode == .recording && state.expanded)
    }

    /// Back to rest: the last call's update if one is pending, else the mark beside the camera.
    func hide() {
        startTimeout?.cancel()
        hangUp?.cancel()
        recordingCaller = nil
        calls.ignoresWebKit = false
        state.callContact = nil
        rest()
    }

    private func rest() {
        if let postCall = state.postCall {
            transition(to: .postCall, expanded: postCall.stage != .writing)
            if postCall.stage != .writing { startCountdown(postCall.stage == .done ? Self.doneLinger : Self.postCallLinger) }
        } else {
            transition(to: .idle, expanded: false)
        }
    }

    func toggle() {
        switch state.mode {
        case .recording:
            transition(to: .recording, expanded: !state.expanded)
        case .idle, .call:
            transition(to: state.mode, expanded: !state.expanded)
            if state.expanded { startCountdown(state.mode == .idle ? Self.idleLinger : Self.callLinger) }
        case .postCall:
            transition(to: .postCall, expanded: !state.expanded)
            if state.expanded { startCountdown(Self.postCallLinger) }
        case .starting:
            break
        }
    }

    func collapse() {
        if state.expanded { transition(to: state.mode, expanded: false) }
    }

    /// The pointer holds a self-closing dropdown open; leaving lets the line run out again.
    func pointer(inside: Bool) {
        guard var countdown = state.countdown, state.expanded else { return }
        let now = Date()
        if inside, let since = countdown.runningSince {
            countdown.remaining -= now.timeIntervalSince(since)
            countdown.runningSince = nil
            autoClose?.cancel()
        } else if !inside, countdown.runningSince == nil {
            // Never snaps shut the moment the pointer leaves.
            countdown.remaining = max(countdown.remaining, 1.5)
            countdown.runningSince = now
            scheduleAutoClose(after: countdown.remaining)
        }
        state.countdown = countdown
    }

    private func startCountdown(_ total: TimeInterval) {
        state.countdown = .init(total: total, remaining: total, runningSince: Date())
        scheduleAutoClose(after: total)
    }

    private func scheduleAutoClose(after delay: TimeInterval) {
        autoClose?.cancel()
        autoClose = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, !Task.isCancelled, self.state.countdown != nil else { return }
            if self.state.mode == .postCall, self.state.postCall?.stage == .done {
                self.dismissPostCall()
            } else {
                self.collapse()
            }
        }
    }

    /// The memo is written in the background; the island shows its update when it's ready.
    func stop() {
        hide()
        bridge?.emitCommand("stop")
    }

    func openApp() {
        bridge?.showMainWindow()
    }

    func togglePause() {
        bridge?.emitCommand(state.paused ? "resume" : "pause")
    }

    /// Search lives with the full transcript in the main window.
    func search() {
        bridge?.emitCommand("search")
        bridge?.showMainWindow()
    }

    /// Starts in the background so the call keeps focus; errors bring Vocify forward.
    /// Signed out, it opens Vocify to sign in instead of waiting on a recorder that isn't there.
    func record() {
        let previous = state.mode
        guard previous == .idle || { if case .call = previous { return true } else { return false } }() else { return }
        guard state.recorderReady else {
            openApp()
            return
        }
        if case .call(let caller) = previous { recordingCaller = caller }
        calls.ignoresWebKit = true
        transition(to: .starting, expanded: false)
        bridge?.emitCommand("listen")
        startTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard let self, !Task.isCancelled, self.state.mode == .starting else { return }
            self.calls.ignoresWebKit = false
            self.transition(to: previous, expanded: false)
            self.bridge?.showMainWindow()
        }
    }

    func dismissCall() {
        callHandled = true
        hide()
    }

    func approvePostCall() {
        bridge?.emitCommand("postcall:approve")
    }

    /// The memo's review screen, for anything the one click doesn't cover.
    func reviewPostCall() {
        bridge?.emitCommand("postcall:review")
        bridge?.showMainWindow()
    }

    func dismissPostCall() {
        bridge?.emitCommand("postcall:dismiss")
    }

    /// The dashboard moved the memo on (written, ready, approved...).
    private func postCallChanged() {
        switch state.mode {
        case .recording, .starting, .call:
            return  // shown once the island is back at rest
        case .idle, .postCall:
            if state.postCall == nil {
                if state.mode == .postCall { transition(to: .idle, expanded: false) }
            } else if state.postCall?.stage == .approving, state.mode == .postCall, state.expanded {
                return  // the open menu shows the progress in place
            } else {
                rest()
            }
        }
    }

    private func callChanged(_ caller: MicActivityMonitor.Caller?) {
        currentCaller = caller
        if caller == nil {
            callHandled = false
            if state.mode != .recording, state.mode != .starting { bridge?.emitCallEnded() }
        }
        switch state.mode {
        case .recording:
            watchForHangUp(caller)
            return
        case .starting:
            return
        case .idle, .call, .postCall:
            if let caller, !callHandled, bridge?.isListening != true {
                guard state.mode != .call(caller) else { return }
                state.callContact = nil
                // Drops down once to be noticed, then settles beside the camera.
                transition(to: .call(caller), expanded: true)
                startCountdown(Self.callLinger)
                lookUpCallContact()
            } else if case .call = state.mode {
                hide()
            }
        }
    }

    /// Recording a detected call: the call app letting go of the mic ends the recording too.
    /// Safari's calls can't be told apart from Vocify's own capture, so they end on Stop.
    private func watchForHangUp(_ caller: MicActivityMonitor.Caller?) {
        guard let recorded = recordingCaller, recorded.bundleID != nil else { return }
        guard caller == nil else {
            hangUp?.cancel()
            return
        }
        hangUp?.cancel()
        hangUp = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.hangUpGrace * 1_000_000_000))
            guard let self, !Task.isCancelled, self.state.mode == .recording, self.currentCaller == nil else { return }
            self.bridge?.emitCallEnded()
            self.stop()
        }
    }

    /// Reads the CRM page on screen; the dashboard turns it into the contact's name.
    private func lookUpCallContact() {
        Task { @MainActor [weak self] in
            let read = await CrmPageReader.read(ask: true)
            guard let self, case .call = self.state.mode,
                  let urls = read["urls"] as? [String], !urls.isEmpty else { return }
            self.bridge?.emitCallPages(urls)
        }
    }

    private func remeasure() {
        state.geometry = IslandGeometry.measure(IslandGeometry.screen())
        guard let panel, panel.isVisible else { return }
        panel.setFrame(frame(for: state.size(for: state.mode, open: state.expanded)), display: true)
    }

    /// Hangs from the top edge, centred on the camera housing.
    private func frame(for size: CGSize) -> NSRect {
        guard let screen = IslandGeometry.screen() else { return NSRect(origin: .zero, size: size) }
        var midX = screen.frame.midX
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            midX = (left.maxX + right.minX) / 2
        }
        return NSRect(x: (midX - size.width / 2).rounded(), y: screen.frame.maxY - size.height, width: size.width, height: size.height)
    }

    /// The window first covers both the old and new shape, the shape animates inside it,
    /// then the window fits the new shape. The frame and SwiftUI never animate against each other.
    private func transition(to mode: MeetingPillState.Mode, expanded: Bool) {
        autoClose?.cancel()
        state.countdown = nil
        let panel = ensure()
        let wasVisible = panel.isVisible
        state.geometry = IslandGeometry.measure(IslandGeometry.screen())
        let target = state.size(for: mode, open: expanded)
        let current = wasVisible ? panel.frame.size : target
        let cover = CGSize(width: max(current.width, target.width), height: max(current.height, target.height))
        panel.setFrame(frame(for: cover), display: true)
        panel.hasShadow = expanded
        if !wasVisible { panel.orderFrontRegardless() }

        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let animation: Animation = reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.34, dampingFraction: 0.86)
        withAnimation(wasVisible ? animation : nil) {
            state.mode = mode
            state.expanded = expanded
        } completion: { [weak self] in
            guard let self, self.state.mode == mode, self.state.expanded == expanded else { return }
            panel.setFrame(self.frame(for: target), display: true)
            panel.invalidateShadow()
        }
    }

    private func ensure() -> NSPanel {
        if let panel { return panel }
        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: state.size(for: .idle, open: false)),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        // Above the menu bar, so the island can sit beside the camera housing.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        // Black like the camera housing it grows out of, in light and dark mode alike.
        panel.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: IslandView(state: state, controller: self))
        host.sizingOptions = []
        panel.contentView = host
        self.panel = panel
        return panel
    }
}

private enum IslandStyle {
    static let beige = Color(hue: 35 / 360, saturation: 0.30, brightness: 0.86)
    static let danger = Color(hue: 0, saturation: 0.66, brightness: 0.86)
    static let youBubble = Color(hue: 36 / 360, saturation: 0.30, brightness: 0.34)
    static let themBubble = Color.white.opacity(0.13)
    static let text = Color.white.opacity(0.92)
    static let secondary = Color.white.opacity(0.72)
    static let collapsedRadius: CGFloat = 12
    static let openRadius: CGFloat = 22
}

struct IslandView: View {
    @ObservedObject var state: MeetingPillState
    let controller: MeetingPillController
    @State private var hovering = false

    private var open: Bool { state.expanded && state.mode != .starting }
    private var isCall: Bool {
        switch state.mode {
        case .call, .postCall: return true
        default: return false
        }
    }
    private var size: CGSize { state.size(for: state.mode, open: open) }
    private var ear: CGFloat { state.geometry.earWidth(state.mode, open: open) }
    private var radius: CGFloat {
        guard open else { return IslandStyle.collapsedRadius }
        return state.mode == .recording ? IslandStyle.openRadius : 18
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if open {
                switch state.mode {
                case .recording:
                    OpenIsland(state: state, controller: controller)
                        .transition(.opacity)
                case .call(let caller):
                    CallMenu(caller: caller, contact: state.callContact, ready: state.recorderReady, controller: controller)
                        .transition(.opacity)
                case .postCall:
                    if let postCall = state.postCall {
                        PostCallMenu(postCall: postCall, controller: controller)
                            .transition(.opacity)
                    }
                default:
                    IdleMenu(ready: state.recorderReady, controller: controller)
                        .transition(.opacity)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if open, let countdown = state.countdown {
                CountdownLine(countdown: countdown)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 5)
                    .transition(.opacity)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .background(IslandBackground(open: open, barHeight: state.geometry.barHeight))
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous))
        .overlay(GlassRim(radius: radius, barHeight: state.geometry.barHeight).opacity(open ? 1 : 0))
        .onHover { inside in
            hovering = inside
            controller.pointer(inside: inside)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }

    /// The strip level with the camera: one ear each side of it, the same when open or closed.
    private var topBar: some View {
        HStack(spacing: 0) {
            leftEar
                .padding(.leading, !open && state.mode != .recording ? 12 : 14)
                .frame(width: ear, alignment: .leading)
            Spacer(minLength: state.geometry.notchWidth)
            rightEar
                .padding(.trailing, !open && isCall ? 10 : 12)
                .frame(width: ear, alignment: .trailing)
        }
        .padding(.horizontal, open ? 6 : 0)
        .frame(height: state.geometry.barHeight)
        .contentShape(Rectangle())
        .onTapGesture { controller.toggle() }
        .help(helpText)
    }

    private var helpText: String {
        switch state.mode {
        case .recording: return open ? "Hide transcript" : "Show transcript"
        case .idle: return open ? "Close" : "Record a meeting"
        case .call: return open ? "Close" : ""
        case .starting: return ""
        case .postCall:
            switch state.postCall?.stage {
            case .writing: return "Writing the update"
            case .ready: return open ? "Close" : "Update ready"
            case .review: return open ? "Close" : "Needs a look"
            default: return ""
            }
        }
    }

    @ViewBuilder private var leftEar: some View {
        switch state.mode {
        case .recording:
            HStack(spacing: 6) {
                RecordingDot(paused: state.paused)
                ElapsedText(clock: state.clock)
            }
        case .call(let caller):
            CallerIcon(caller: caller)
        case .starting:
            ProgressView().controlSize(.mini)
        case .idle:
            VocifyMarkIcon()
                .opacity(hovering || open ? 1 : 0.85)
        case .postCall:
            switch state.postCall?.stage {
            case .writing, .approving:
                ProgressView().controlSize(.mini)
            case .done:
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(IslandStyle.beige)
            default:
                VocifyMarkIcon()
            }
        }
    }

    @ViewBuilder private var rightEar: some View {
        switch state.mode {
        case .recording:
            HStack(spacing: 7) {
                if state.paused {
                    Text("Paused")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(IslandStyle.secondary)
                } else {
                    if state.assist != nil, !open {
                        Image(systemName: "sparkle")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(IslandStyle.beige)
                            .help("Live help is ready")
                            .transition(.opacity)
                    }
                    VoiceWave(levels: state.levels)
                }
                OpenArrow(open: open)
            }
            .animation(.easeOut(duration: 0.4), value: state.assist != nil)
        case .call(let caller):
            if open {
                OpenArrow(open: true)
            } else {
                RecordDot(caller: caller, ready: state.recorderReady, action: controller.record)
            }
        case .starting:
            Text("Starting")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(IslandStyle.secondary)
        case .idle:
            OpenArrow(open: open)
                .opacity(hovering || open ? 1 : 0.8)
        case .postCall:
            if open {
                OpenArrow(open: true)
            } else if let postCall = state.postCall, postCall.stage == .ready || postCall.stage == .review {
                UpdatesBadge(postCall: postCall)
            }
        }
    }
}

/// Opened from the mark when nothing is recording: the one thing to do here is record.
private struct IdleMenu: View {
    let ready: Bool
    let controller: MeetingPillController

    var body: some View {
        HStack(spacing: 8) {
            QuietRecordButton(title: "Record meeting", ready: ready, action: controller.record)
            Spacer(minLength: 0)
            IconButton(symbol: "arrow.up.right", help: "Open Vocify", action: controller.openApp)
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
    }
}

/// A call just started: who it is with (the CRM contact on screen) or which app,
/// and one quiet way to record it.
private struct CallMenu: View {
    let caller: MicActivityMonitor.Caller
    let contact: String?
    let ready: Bool
    let controller: MeetingPillController

    var body: some View {
        HStack(spacing: 8) {
            Text(contact ?? caller.name.map { "\($0) call" } ?? "Call in progress")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(contact == nil ? IslandStyle.secondary : IslandStyle.text)
                .lineLimit(1)
            Spacer(minLength: 0)
            QuietRecordButton(title: "Record", ready: ready, action: controller.record)
            IconButton(symbol: "xmark", help: "Not now", action: controller.dismissCall)
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
    }
}

/// Glass like the island, with only a small red dot saying what it does.
/// Signed out, it says so and opens Vocify instead.
private struct QuietRecordButton: View {
    let title: String
    let ready: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if ready {
                    Circle().fill(IslandStyle.danger).frame(width: 7, height: 7)
                }
                Text(ready ? title : "Sign in to record").font(.system(size: 12.5, weight: .medium))
            }
            .foregroundStyle(IslandStyle.text)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Color.white.opacity(hovering ? 0.17 : 0.10), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(ready ? "Records your mic as You and the call as Them" : "Opens Vocify to sign in")
    }
}

/// The record action in the closed call island: a red dot in a faint circle.
private struct RecordDot: View {
    let caller: MicActivityMonitor.Caller
    let ready: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(ready ? IslandStyle.danger : IslandStyle.secondary)
                .frame(width: 7, height: 7)
                .frame(width: 22, height: 22)
                .background(Color.white.opacity(hovering ? 0.2 : 0.11), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(ready ? caller.name.map { "Record this \($0) call" } ?? "Record this call" : "Sign in to record")
        .accessibilityLabel("Record")
    }
}

/// After the call: who it was with, what changes in the CRM, and one click to apply it.
private struct PostCallMenu: View {
    let postCall: MeetingPillState.PostCall
    let controller: MeetingPillController

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(postCall.contactName ?? "Your call")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(IslandStyle.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11.5))
                    .foregroundStyle(IslandStyle.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            if showsChanges {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(postCall.updates.prefix(3)) { update in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(update.label)
                                .foregroundStyle(IslandStyle.secondary)
                                .frame(width: 112, alignment: .leading)
                                .lineLimit(1)
                            Text(update.value)
                                .foregroundStyle(IslandStyle.text)
                                .lineLimit(1)
                        }
                        .font(.system(size: 11.5))
                    }
                }
                HStack(spacing: 8) {
                    if postCall.canApprove, postCall.stage != .review {
                        QuietActionButton(
                            title: postCall.stage == .approving ? "Updating" : "Approve",
                            symbol: "checkmark",
                            busy: postCall.stage == .approving,
                            help: "Writes these changes to the contact in HubSpot",
                            action: controller.approvePostCall
                        )
                    }
                    QuietActionButton(title: "Review", symbol: "arrow.up.right", busy: false, help: "Opens the memo in Vocify", action: controller.reviewPostCall)
                    Spacer(minLength: 0)
                    IconButton(symbol: "xmark", help: "Later", action: controller.dismissPostCall)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 7)
        .frame(maxHeight: .infinity, alignment: .top)
        .animation(.easeOut(duration: 0.2), value: postCall.stage)
    }

    private var showsChanges: Bool {
        postCall.stage == .ready || postCall.stage == .approving || postCall.stage == .review
    }

    private var subtitle: String {
        switch postCall.stage {
        case .writing: return "Writing the update…"
        case .ready, .approving:
            return postCall.total == 1 ? "1 change for HubSpot" : "\(postCall.total) changes for HubSpot"
        case .done: return "Updated in HubSpot"
        case .review: return postCall.note ?? "Needs a look"
        }
    }
}

/// How many changes wait for the closed island: a small beige count.
private struct UpdatesBadge: View {
    let postCall: MeetingPillState.PostCall

    var body: some View {
        Text(postCall.stage == .review ? "!" : "\(postCall.total)")
            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
            .foregroundStyle(Color.black.opacity(0.85))
            .frame(minWidth: 18, minHeight: 18)
            .background(IslandStyle.beige, in: Capsule())
            .help(postCall.stage == .review ? "The call's memo needs a look" : "Changes ready for HubSpot")
    }
}

/// Glass button with an icon; the island's quiet secondary action.
private struct QuietActionButton: View {
    let title: String
    let symbol: String
    let busy: Bool
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: symbol).font(.system(size: 10, weight: .semibold))
                }
                Text(title).font(.system(size: 12.5, weight: .medium))
            }
            .foregroundStyle(IslandStyle.text)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Color.white.opacity(hovering ? 0.17 : 0.10), in: Capsule())
        }
        .buttonStyle(PressScale())
        .disabled(busy)
        .onHover { hovering = $0 }
        .help(help)
    }
}

/// How long a dropdown stays: a hairline that shrinks to nothing, then it folds away.
private struct CountdownLine: View {
    let countdown: MeetingPillState.Countdown

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { context in
            GeometryReader { geo in
                Capsule()
                    .fill(Color.white.opacity(0.32))
                    .frame(width: geo.size.width * countdown.fraction(at: context.date), height: 2)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

/// Says the island opens; points up once it has. The whole strip is the button.
private struct OpenArrow: View {
    let open: Bool

    var body: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(IslandStyle.secondary)
            .rotationEffect(.degrees(open ? 180 : 0))
            .accessibilityLabel(open ? "Close" : "Open")
    }
}

private struct VocifyMarkIcon: View {
    var body: some View {
        Group {
            if let mark = VocifyMark.image {
                Image(nsImage: mark).resizable().interpolation(.high)
            } else {
                Image(systemName: "waveform").foregroundStyle(IslandStyle.text)
            }
        }
        .frame(width: 16, height: 16)
        .accessibilityLabel("Vocify")
    }
}

/// Controls, live help and the whole conversation.
private struct OpenIsland: View {
    @ObservedObject var state: MeetingPillState
    let controller: MeetingPillController
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                CircleButton(
                    symbol: state.paused ? "play.fill" : "pause.fill",
                    help: state.paused ? "Resume recording" : "Pause recording",
                    action: controller.togglePause
                )
                StopButton(action: controller.stop)
                Spacer(minLength: 0)
                IconButton(symbol: "magnifyingglass", help: "Search transcript", action: controller.search)
                IconButton(symbol: "arrow.up.right", help: "Open Vocify", action: controller.openApp)
            }
            .padding(.horizontal, 14)
            .frame(height: 38)
            // Live help has its own fixed place above the conversation; only the conversation gives up space.
            HelpSection(current: state.assist, earlier: state.lastHelp)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            Rectangle().fill(Color.white.opacity(0.07)).frame(height: 0.5)
            TranscriptScroll(turns: state.turns)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: state.assist)
    }
}

private struct BottomEdgeKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Scrolls freely; follows the newest line only while the reader is at the bottom.
private struct TranscriptScroll: View {
    let turns: [MeetingPillState.Turn]
    @State private var following = true
    private static let bottom = "bottom"
    /// More than one streamed update grows the content, so growth alone never counts as scrolling away.
    private static let followSlack: CGFloat = 120

    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        if turns.isEmpty {
                            Text("Listening…")
                                .font(.system(size: 12.5))
                                .foregroundStyle(IslandStyle.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 28)
                        }
                        LazyVStack(spacing: 8) {
                            ForEach(turns) { turn in
                                TurnBubble(turn: turn).equatable()
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 10)
                        Color.clear
                            .frame(height: 12)
                            .id(Self.bottom)
                            .background(
                                GeometryReader { edge in
                                    Color.clear.preference(key: BottomEdgeKey.self, value: edge.frame(in: .named("transcript")).maxY)
                                }
                            )
                    }
                }
                .coordinateSpace(name: "transcript")
                .defaultScrollAnchor(.bottom)
                .onPreferenceChange(BottomEdgeKey.self) { edge in
                    let next = edge <= viewport.size.height + Self.followSlack
                    if next != following { following = next }
                }
                .onChange(of: turns) {
                    if following { jump(proxy) }
                }
                .onAppear { jump(proxy) }
                .overlay(alignment: .bottom) {
                    if !following {
                        LatestButton { jump(proxy) }
                            .padding(.bottom, 10)
                            .transition(.opacity)
                    }
                }
            }
        }
    }

    private func jump(_ proxy: ScrollViewProxy) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
    }
}

/// One speaker's paragraph. Words still settling are dimmed inline, so the bubble only ever grows.
private struct TurnBubble: View, Equatable {
    let turn: MeetingPillState.Turn

    var body: some View {
        VStack(alignment: turn.you ? .trailing : .leading, spacing: 3) {
            if !turn.you, let label = turn.label {
                Text(label)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(IslandStyle.beige)
                    .padding(.horizontal, 4)
            }
            words
                .font(.system(size: 12.5))
                .lineSpacing(1.5)
                .textSelection(.enabled)
                .padding(.horizontal, 11)
                .padding(.vertical, 7)
                .background(
                    turn.you ? IslandStyle.youBubble : IslandStyle.themBubble,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 340, alignment: turn.you ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: turn.you ? .trailing : .leading)
        .transaction { $0.animation = nil }
    }

    private var words: Text {
        let settled = Text(turn.text).foregroundColor(IslandStyle.text)
        guard !turn.pending.isEmpty else { return settled }
        let joined = turn.text.isEmpty || turn.pending.first.map { ",.;:!?…)".contains($0) } == true
        let tail = Text((joined ? "" : " ") + turn.pending).foregroundColor(IslandStyle.secondary)
        return turn.text.isEmpty ? tail : settled + tail
    }
}

private struct ElapsedText: View {
    let clock: MeetingPillState.Clock?

    var body: some View {
        Group {
            if let clock, clock.pausedAt == nil {
                TimelineView(.periodic(from: clock.tickOrigin, by: 1)) { context in
                    label(clock.elapsed(at: context.date))
                }
            } else {
                label(clock?.elapsed(at: Date()) ?? 0)
            }
        }
        .font(.system(size: 12.5, weight: .medium).monospacedDigit())
        .foregroundStyle(IslandStyle.text)
        .fixedSize()
    }

    private func label(_ elapsed: TimeInterval) -> Text {
        // A tick can land a hair before the whole second it stands for.
        let total = Int((elapsed + 0.05).rounded(.down))
        let (h, m, s) = (total / 3600, total % 3600 / 60, total % 60)
        return Text(h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s))
    }
}

/// One small voice wave: moves while anyone talks, beige when it's you, white when it's them.
/// Flat and dim in silence, so it never looks like activity that isn't there.
private struct VoiceWave: View {
    let levels: LevelStore
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    private static let rest: [CGFloat] = [3, 4.5, 6, 4.5, 3]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 24, paused: reduceMotion)) { context in
            let you = levels.value(you: true, at: context.date)
            let them = levels.value(you: false, at: context.date)
            let level = min(1, max(you, them) * 1.4)
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 2) {
                ForEach(0..<5, id: \.self) { index in
                    let wave = reduceMotion ? 1 : 0.55 + 0.45 * sin(t * 9 + Double(index) * 1.2)
                    Capsule()
                        .fill(you >= them ? IslandStyle.beige : Color.white.opacity(0.85))
                        .frame(width: 2.5, height: Self.rest[index] + 10 * level * CGFloat(wave))
                }
            }
            .frame(height: 16)
            .opacity(level > 0.05 ? 1 : 0.45)
        }
        .help("Beige: you speaking · White: them")
        .accessibilityLabel("Voice activity")
    }
}

private struct RecordingDot: View {
    let paused: Bool
    @State private var dim = false
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        Circle()
            .fill(paused ? Color.white.opacity(0.4) : IslandStyle.danger)
            .frame(width: 7, height: 7)
            .opacity(dim && !paused ? 0.35 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = !reduceMotion }
            .accessibilityLabel(paused ? "Paused" : "Recording")
    }
}

private struct CallerIcon: View {
    let caller: MicActivityMonitor.Caller

    var body: some View {
        Group {
            if let id = caller.bundleID, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: url.path))
                    .resizable()
                    .frame(width: 18, height: 18)
            } else {
                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(IslandStyle.text)
            }
        }
        .help(caller.name.map { "\($0) is using the mic" } ?? "A call is using the mic")
    }
}

private struct LatestButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.down").font(.system(size: 9.5, weight: .semibold))
                Text("Latest").font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(IslandStyle.text)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Color(white: 0.2), in: Capsule())
        }
        .buttonStyle(PressScale())
        .help("Jump to the latest line")
    }
}

/// Live help, quiet by design: plain text in a fixed place, no boxes or alerts.
/// A draft offers the bridge line, the answer replaces it in place, and once it
/// retires it stays dimmed as "Earlier" until the next one.
private struct HelpSection: View {
    let current: MeetingPillState.Assist?
    let earlier: MeetingPillState.Assist?

    private var shown: MeetingPillState.Assist? { current ?? earlier }
    private var retired: Bool { current == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(IslandStyle.beige.opacity(retired ? 0.5 : 1))
                Text(heading)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(retired ? IslandStyle.secondary : IslandStyle.beige)
            }
            if let help = shown {
                if help.drafting {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("“\(help.bridge)”")
                            .font(.system(size: 12.5).italic())
                            .foregroundStyle(IslandStyle.text)
                            .lineLimit(2)
                        TypingDots()
                    }
                } else {
                    Text(help.sayThis)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(IslandStyle.text)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if !help.thenAsk.isEmpty {
                        Text(help.thenAsk)
                            .font(.system(size: 11.5))
                            .foregroundStyle(IslandStyle.secondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                Text("Answers show up here when they ask or push back.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(IslandStyle.secondary.opacity(0.8))
            }
        }
        .opacity(retired && shown != nil ? 0.55 : 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .accessibilityElement(children: .combine)
    }

    private var heading: String {
        guard let shown else { return "Live help" }
        if retired { return "Earlier" }
        return shown.label.isEmpty ? "Live help" : shown.label
    }
}

/// Solid black beside the camera so the island still reads as part of it;
/// below that, dark glass: a blur of what's behind with a light sheen at the top.
private struct IslandBackground: View {
    let open: Bool
    let barHeight: CGFloat

    var body: some View {
        ZStack(alignment: .top) {
            BehindWindowBlur()
            Color.black.opacity(open ? 0.28 : 1)
            LinearGradient(colors: [Color.white.opacity(open ? 0.07 : 0), .clear], startPoint: .top, endPoint: .center)
            // The camera strip melts into the glass instead of ending on a hard line.
            VStack(spacing: 0) {
                Color.black.frame(height: barHeight)
                LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: open ? 16 : 0)
            }
        }
    }
}

/// The glass edge: a thin light rim and a soft inner glow down the sides and round
/// the bottom corners. It fades in below the camera strip, which stays plain black.
private struct GlassRim: View {
    let radius: CGFloat
    let barHeight: CGFloat

    var body: some View {
        let shape = UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous)
        ZStack {
            shape
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 6)
                .blur(radius: 5)
                .clipShape(shape)
            shape.strokeBorder(
                LinearGradient(
                    colors: [Color.white.opacity(0.34), Color.white.opacity(0.08), Color.white.opacity(0.24)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: 1
            )
        }
        .mask(
            VStack(spacing: 0) {
                Color.clear.frame(height: barHeight)
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 28)
                Color.black
            }
        )
        .allowsHitTesting(false)
    }
}

private struct BehindWindowBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

private struct TypingDots: View {
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Color.white.opacity(0.5))
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * max(0, sin((t * 4) - Double(index) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Writing")
    }
}

private struct StopButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(Color.white)
                    .frame(width: 8, height: 8)
                Text("Stop").font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(IslandStyle.danger.opacity(hovering ? 0.85 : 1), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help("Stop and review")
        .accessibilityLabel("Stop recording")
    }
}

private struct CircleButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(IslandStyle.text)
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(hovering ? 0.18 : 0.11), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

private struct IconButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hovering ? IslandStyle.text : IslandStyle.secondary)
                .frame(width: 26, height: 26)
                .background(Color.white.opacity(hovering ? 0.1 : 0), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

private struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
