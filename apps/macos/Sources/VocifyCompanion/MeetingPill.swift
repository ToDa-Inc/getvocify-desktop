import AppKit
import SwiftUI
import VocifyCore

/// What the dashboard streams to the floating pill through `shell:state`.
@MainActor
final class MeetingPillState: ObservableObject {
    struct Turn: Identifiable, Equatable {
        let id: String
        let you: Bool
        let label: String?
        let text: String
        let pending: String
    }

    @Published var elapsed = "00:00"
    @Published var line = ""
    @Published var lineLabel: String?
    struct Assist: Equatable {
        let label: String
        let sayThis: String
        let thenAsk: String
    }

    @Published var recent: [Turn] = []
    @Published var expanded = false
    @Published var paused = false
    @Published var assist: Assist?

    func apply(_ state: [String: Any]) {
        if let elapsed = state["elapsed"] as? String, elapsed != self.elapsed { self.elapsed = elapsed }
        if let paused = state["paused"] as? Bool, paused != self.paused { self.paused = paused }
        if state.keys.contains("assist") {
            let raw = state["assist"] as? [String: Any]
            let next = raw.flatMap { raw -> Assist? in
                guard let say = raw["sayThis"] as? String, !say.isEmpty else { return nil }
                return Assist(label: raw["label"] as? String ?? "", sayThis: say, thenAsk: raw["thenAsk"] as? String ?? "")
            }
            if next != assist { assist = next }
        }
        guard let overlay = state["overlay"] as? [String: Any] else { return }
        let line = overlay["line"] as? String ?? ""
        if line != self.line { self.line = line }
        let label = (overlay["lineLabel"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        if label != lineLabel { lineLabel = label }
        let turns = (overlay["recent"] as? [[String: Any]] ?? []).map { raw in
            Turn(
                id: raw["key"] as? String ?? UUID().uuidString,
                you: raw["you"] as? Bool ?? false,
                label: raw["label"] as? String,
                text: raw["text"] as? String ?? "",
                pending: raw["pending"] as? String ?? ""
            )
        }
        if turns != recent { recent = turns }
    }
}

/// Keeps the pill clickable on the first click without activating Vocify.
private final class PillPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
final class MeetingPillController {
    static let shared = MeetingPillController()

    static let collapsed = NSSize(width: 340, height: 44)
    static let open = NSSize(width: 372, height: 300)
    private static let margin: CGFloat = 16

    static let collapsedRadius: CGFloat = 22
    static let openRadius: CGFloat = 18

    let state = MeetingPillState()
    private var panel: NSPanel?
    private var surface: NSVisualEffectView?
    private weak var bridge: DesktopBridge?

    func show(bridge: DesktopBridge) {
        self.bridge = bridge
        let panel = ensure()
        if !panel.isVisible {
            state.expanded = false
            setCorner(Self.collapsedRadius)
            if let area = NSScreen.main?.visibleFrame {
                let size = Self.collapsed
                panel.setFrame(
                    NSRect(x: area.maxX - size.width - Self.margin, y: area.minY + Self.margin, width: size.width, height: size.height),
                    display: true
                )
            }
        }
        panel.orderFrontRegardless()
        panel.invalidateShadow()
    }

    func hide() {
        panel?.orderOut(nil)
        state.expanded = false
    }

    func toggle() {
        setExpanded(!state.expanded)
    }

    func stop() {
        hide()
        bridge?.emitCommand("stop")
        bridge?.showMainWindow()
    }

    func openApp() {
        bridge?.showMainWindow()
    }

    func togglePause() {
        bridge?.emitCommand(state.paused ? "resume" : "pause")
    }

    func collapse() {
        if state.expanded { setExpanded(false) }
    }

    /// Hands the drag to AppKit so the pill moves like any window, anywhere on screen.
    func beginDrag() {
        guard let panel, let event = NSApp.currentEvent else { return }
        panel.performDrag(with: event)
    }

    /// Search lives with the full transcript in the main window.
    func search() {
        bridge?.emitCommand("search")
        bridge?.showMainWindow()
    }

    /// The material itself is masked, so corners and the system shadow follow the real shape.
    private func setCorner(_ radius: CGFloat) {
        surface?.maskImage = Self.roundedMask(radius)
        panel?.invalidateShadow()
    }

    private static func roundedMask(_ radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }

    /// Grows from the bottom-right corner (or wherever the user dragged it), kept on screen.
    private func setExpanded(_ expanded: Bool) {
        guard let panel else { return }
        let size = expanded ? Self.open : Self.collapsed
        var frame = NSRect(x: panel.frame.maxX - size.width, y: panel.frame.minY, width: size.width, height: size.height)
        if let area = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame {
            frame.origin.x = min(max(frame.minX, area.minX + Self.margin), area.maxX - size.width - Self.margin)
            frame.origin.y = min(max(frame.minY, area.minY + Self.margin), area.maxY - size.height - Self.margin)
        }
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if expanded { setCorner(Self.openRadius) }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.84)) {
            state.expanded = expanded
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = reduceMotion ? 0 : 0.34
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1.0)
            panel.animator().setFrame(frame, display: true)
        } completionHandler: {
            Task { @MainActor in
                if !expanded { self.setCorner(Self.collapsedRadius) }
                panel.invalidateShadow()
            }
        }
    }

    private func ensure() -> NSPanel {
        if let panel { return panel }
        let panel = PillPanel(
            contentRect: NSRect(origin: .zero, size: Self.collapsed),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        // Vocify's paper look in light and dark mode alike; dark mode made the text unreadable.
        panel.appearance = NSAppearance(named: .aqua)
        let surface = NSVisualEffectView(frame: NSRect(origin: .zero, size: Self.collapsed))
        surface.material = .popover
        surface.blendingMode = .behindWindow
        surface.state = .active
        surface.autoresizingMask = [.width, .height]
        let host = NSHostingView(rootView: MeetingPillView(state: state, controller: self))
        host.sizingOptions = []
        host.frame = surface.bounds
        host.autoresizingMask = [.width, .height]
        surface.addSubview(host)
        panel.contentView = surface
        self.panel = panel
        self.surface = surface
        setCorner(Self.collapsedRadius)
        return panel
    }
}

private enum PillStyle {
    static let beige = Color(hue: 35 / 360, saturation: 0.30, brightness: 0.45)
    static let danger = Color(hue: 0, saturation: 0.66, brightness: 0.78)
    static let youBubble = Color(hue: 36 / 360, saturation: 0.30, brightness: 0.94)
    static let themBubble = Color.primary.opacity(0.06)
}

struct MeetingPillView: View {
    @ObservedObject var state: MeetingPillState
    let controller: MeetingPillController
    @State private var pulse = false
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    private var radius: CGFloat {
        state.expanded ? MeetingPillController.openRadius : MeetingPillController.collapsedRadius
    }

    var body: some View {
        VStack(spacing: 0) {
            if state.expanded {
                if let assist = state.assist {
                    AssistCard(assist: assist)
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                conversation
                    .transition(.opacity.combined(with: .offset(y: 8)))
            }
            bar
        }
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86), value: state.assist)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 3).onChanged { _ in controller.beginDrag() })
        .environment(\.colorScheme, .light)
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }

    private var bar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(state.paused ? Color.secondary.opacity(0.5) : PillStyle.danger)
                .frame(width: 7, height: 7)
                .opacity(pulse && !state.paused ? 0.35 : 1)
                .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
                .onAppear { pulse = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
            Text(state.elapsed)
                .font(.system(size: 13, weight: .medium).monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.trailing, 2)
            if state.expanded {
                Spacer(minLength: 0)
                IconButton(symbol: "magnifyingglass", help: "Search transcript", action: controller.search)
                IconButton(symbol: "arrow.up.right", help: "Open Vocify", action: controller.openApp)
                IconButton(symbol: "chevron.down", help: "Make smaller", action: controller.collapse)
            } else if state.paused {
                Text("Paused")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                liveLine
            }
            IconButton(
                symbol: state.paused ? "play.fill" : "pause.fill",
                help: state.paused ? "Resume recording" : "Pause recording",
                action: controller.togglePause
            )
            StopButton(showLabel: state.expanded, action: controller.stop)
        }
        .padding(.leading, 16)
        .padding(.trailing, 7)
        .frame(height: MeetingPillController.collapsed.height)
        .contentShape(Rectangle())
        .onTapGesture(perform: controller.toggle)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(state.expanded ? "Make smaller" : "Show conversation")
    }

    private var liveLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let label = state.lineLabel, !state.line.isEmpty {
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(PillStyle.beige)
            }
            // The longest ending that fits: whole sentences, then whole words. Never a clipped word.
            ViewThatFits(in: .horizontal) {
                ForEach(PhraseFit.candidates(state.line.isEmpty ? "Listening…" : state.line), id: \.self) { candidate in
                    Text(candidate).lineLimit(1).fixedSize()
                }
                Color.clear.frame(width: 0, height: 0)
            }
            .font(.system(size: 13))
            .foregroundStyle(.primary.opacity(0.8))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var conversation: some View {
        VStack(spacing: 6) {
            Spacer(minLength: 0)
            if state.recent.isEmpty {
                Text("The conversation shows up here.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            }
            ForEach(state.recent) { turn in
                TurnBubble(turn: turn)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        // Animate bubbles arriving and leaving only; animating text changes drew old and new words on top of each other.
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: state.recent.map(\.id))
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .frame(maxHeight: .infinity, alignment: .bottom)
        .mask(
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.16)], startPoint: .top, endPoint: .bottom)
        )
        .clipped()
    }
}

private struct TurnBubble: View {
    let turn: MeetingPillState.Turn

    private var fill: Color { turn.you ? PillStyle.youBubble : PillStyle.themBubble }

    var body: some View {
        VStack(alignment: turn.you ? .trailing : .leading, spacing: 2) {
            if !turn.you, let label = turn.label {
                Text(label)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PillStyle.beige)
                    .padding(.horizontal, 4)
            }
            if !turn.text.isEmpty {
                Text(turn.text)
                    .transaction { $0.animation = nil }
                    .font(.system(size: 12.5))
                    .lineSpacing(1.5)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(fill, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Words still settling read as "typing", so bubbles never jump with every guess.
            if !turn.pending.isEmpty {
                TypingDots()
                    .padding(.horizontal, 11)
                    .frame(height: 26)
                    .background(fill, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: 290, alignment: turn.you ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: turn.you ? .trailing : .leading)
    }
}

/// Live help in the opened pill: the same card the meeting screen shows, compact.
private struct AssistCard: View {
    let assist: MeetingPillState.Assist

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if !assist.label.isEmpty {
                Text(assist.label)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PillStyle.beige)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(PillStyle.beige.opacity(0.1), in: Capsule())
            }
            Text(assist.sayThis)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            if !assist.thenAsk.isEmpty {
                Text(assist.thenAsk)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PillStyle.beige.opacity(0.2), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Live help: \(assist.sayThis)")
    }
}

private struct TypingDots: View {
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Color.primary.opacity(0.4))
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * max(0, sin((t * 4) - Double(index) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Speaking")
    }
}

private struct StopButton: View {
    let showLabel: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: "stop.fill").font(.system(size: 10, weight: .semibold))
                if showLabel {
                    Text("Stop").font(.system(size: 12.5, weight: .medium))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, showLabel ? 12 : 0)
            .frame(minWidth: 30, minHeight: 30)
            .background(PillStyle.danger.opacity(hovering ? 0.88 : 1), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help("Stop and review")
        .accessibilityLabel("Stop recording")
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
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(hovering ? .primary : .secondary)
                .frame(width: 30, height: 30)
                .background(Color.primary.opacity(hovering ? 0.07 : 0), in: Circle())
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
