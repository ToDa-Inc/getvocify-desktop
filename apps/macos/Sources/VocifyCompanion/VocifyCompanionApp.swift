import AppKit
import SwiftUI
import VocifyCore

// Tokens from renderer/theme.css. Do not invent a second palette.
enum Vocify {
    static let paper = Color(hue: 40 / 360, saturation: 0.08, brightness: 0.97)
    static let ink = Color(hue: 30 / 360, saturation: 0.10, brightness: 0.16)
    static let mute = Color(hue: 30 / 360, saturation: 0.06, brightness: 0.46)
    static let beige = Color(hue: 35 / 360, saturation: 0.25, brightness: 0.38)
    static let line = Color(hue: 38 / 360, saturation: 0.20, brightness: 0.85)
    static let danger = Color(hue: 0, saturation: 0.72, brightness: 0.55)
    static let card = Color.white
}

enum VocifyMark {
    static var image: NSImage? {
        guard let url = Bundle.main.url(forResource: "icon", withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }

    /// macOS dock icon is a squircle. The source mark is a bubble, so it is drawn inside one.
    static func squircle(side: CGFloat = 128) -> NSImage? {
        guard let mark = image else { return nil }
        let canvas = NSImage(size: NSSize(width: side, height: side))
        canvas.lockFocus()
        let rect = NSRect(x: 0, y: 0, width: side, height: side)
        let path = NSBezierPath(roundedRect: rect, xRadius: side * 0.2237, yRadius: side * 0.2237)
        NSColor(calibratedRed: 0.973, green: 0.957, blue: 0.933, alpha: 1).setFill()
        path.fill()
        path.addClip()
        let inset = side * 0.22
        mark.draw(in: rect.insetBy(dx: inset, dy: inset))
        canvas.unlockFocus()
        return canvas
    }

    static func installDockIcon() {
        NSApp.setActivationPolicy(.regular)
        if let icon = squircle() { NSApp.applicationIconImage = icon }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var bridge: DesktopBridge?

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard bridge?.isListening == true else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "A meeting is still recording"
        alert.informativeText = "What was transcribed so far stays on this Mac and is sent for review next time you open Vocify."
        alert.addButton(withTitle: "Keep recording")
        alert.addButton(withTitle: "Quit")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }
}

@main
struct VocifyCompanionApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = CompanionModel()
    @StateObject private var bridgeHolder = BridgeHolder()
    /// Set `VOCIFY_USE_LEGACY_UI=1` for the old SwiftUI capture screen.
    private var useLegacySwiftUI: Bool {
        ProcessInfo.processInfo.environment["VOCIFY_USE_LEGACY_UI"] == "1"
    }

    var body: some Scene {
        WindowGroup("Vocify") {
            Group {
                if useLegacySwiftUI {
                    RootView()
                        .environmentObject(model)
                } else {
                    WebDashboardView(bridgeHolder: bridgeHolder)
                }
            }
            .frame(minWidth: useLegacySwiftUI ? 380 : 900, minHeight: 640)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background((useLegacySwiftUI ? Vocify.paper : Color.clear).ignoresSafeArea())
            .onAppear {
                VocifyMark.installDockIcon()
                appDelegate.bridge = bridgeHolder.bridge
            }
        }
        .defaultSize(width: useLegacySwiftUI ? 420 : 1200, height: useLegacySwiftUI ? 720 : 820)
        .commands {
            CommandMenu("Meeting") {
                Button("Record / Stop") {
                    bridgeHolder.bridge.showMainWindow()
                    bridgeHolder.bridge.emitCommand("toggle")
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: CompanionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            brand
            switch model.screen {
            case .login: LoginView()
            case .listen: ListenView()
            case .review: ReviewView()
            }
            if !model.error.isEmpty {
                Text(model.error).font(.system(size: 14)).foregroundStyle(Vocify.danger)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 42)
        .padding(.bottom, 28)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .foregroundStyle(Vocify.ink)
        .background(Vocify.paper)
    }

    private var brand: some View {
        HStack(spacing: 10) {
            if let mark = VocifyMark.squircle(side: 64) {
                Image(nsImage: mark)
                    .resizable()
                    .frame(width: 16, height: 16)
            }
            Text("Vocify")
                .font(.system(size: 17, weight: .regular, design: .serif))
            Spacer()
            if model.screen != .login {
                HoverLink(title: "Salir") { model.logout() }
            }
        }
    }
}

struct LoginView: View {
    @EnvironmentObject private var model: CompanionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Entra para ")
                .font(.system(size: 28, weight: .semibold))
            + Text("escuchar")
                .font(.system(size: 28, weight: .regular, design: .serif))
                .italic()
                .foregroundColor(Vocify.beige)
            VocifyLabel("Email")
            VocifyField(title: "Email", text: $model.email)
                .disabled(model.busy)
            VocifyLabel("Contraseña")
            VocifySecret(title: "Contraseña", text: $model.password)
                .disabled(model.busy)
            VocifyPrimary(title: "Entrar", busy: model.busy) {
                Task { await model.login() }
            }
            .disabled(model.busy)
            .padding(.top, 16)
            .opacity(model.busy ? 0.7 : 1)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Vocify.card)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Vocify.line))
    }
}

struct ListenView: View {
    @EnvironmentObject private var model: CompanionModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 0)
            if model.listening {
                HStack(spacing: 8) {
                    Circle().fill(Vocify.danger).frame(width: 8, height: 8)
                    Text(model.elapsed)
                        .font(.system(size: 13))
                        .foregroundStyle(Vocify.danger)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Vocify.danger.opacity(0.1))
                .clipShape(Capsule())
            }
            RecordCore(listening: model.listening, busy: model.busy, elapsed: model.elapsed) {
                Task {
                    if model.listening { await model.stopAndReview() }
                    else { await model.startListen() }
                }
            }
            .frame(width: 80, height: 80)
            if model.listening || !model.note.turns.isEmpty {
                NoteBody(turns: model.note.turns, live: model.listening)
                    .frame(maxWidth: .infinity, minHeight: 140, maxHeight: 260)
            }
            if !model.sayThis.isEmpty {
                Text(model.sayThis)
                    .font(.system(size: 15))
                    .foregroundStyle(Vocify.mute)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if model.listening {
                VocifyStop {
                    Task { await model.stopAndReview() }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct NoteBody: View {
    var turns: [NoteTurn]
    var live: Bool = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(turns.enumerated()), id: \.offset) { index, turn in
                        paragraph(turn)
                            .id(index)
                    }
                    Color.clear.frame(height: 1).id("tail")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .background(Vocify.mute.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(live ? Vocify.beige.opacity(0.35) : Vocify.line)
            )
            .onChange(of: turns.map(\.text).joined()) { _, _ in
                withAnimation(.easeOut(duration: 0.22)) {
                    proxy.scrollTo("tail", anchor: .bottom)
                }
            }
        }
    }

    private func paragraph(_ turn: NoteTurn) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if !turn.label.isEmpty {
                Text(turn.label)
                    .font(.system(size: 12))
                    .foregroundStyle(Vocify.mute)
            }
            (Text(turn.committed).foregroundColor(Vocify.ink)
                + Text(turn.live.isEmpty ? "" : (turn.committed.isEmpty ? turn.live : " \(turn.live)")).foregroundColor(Vocify.mute))
                .font(.system(size: 17))
                .lineSpacing(5)
        }
    }
}

struct ReviewView: View {
    @EnvironmentObject private var model: CompanionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NoteBody(turns: model.note.turns)
                .frame(minHeight: 160)
            if model.busy {
                ProgressView()
                    .controlSize(.small)
            }
            if !model.summary.isEmpty {
            VocifyLabel("Resumen")
            TextEditor(text: $model.summary)
                .font(.system(size: 15))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .padding(10)
                .background(Vocify.paper)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Vocify.line))
            }
            if !model.nextSteps.isEmpty {
            VocifyLabel("Siguientes pasos")
            TextEditor(text: $model.nextSteps)
                .font(.system(size: 15))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 80)
                .padding(10)
                .background(Vocify.paper)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Vocify.line))
            }
            VocifyPrimary(title: "Aprobar") { Task { await model.approve() } }
                .disabled(model.busy)
                .padding(.top, 8)
            VocifyGhost(title: "Volver") { model.screen = .listen }
                .padding(.top, 8)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Vocify.card)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Vocify.line))
    }
}

struct VocifyLabel: View {
    var title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .medium))
            .tracking(0.7)
            .foregroundStyle(Vocify.mute)
            .padding(.top, 14)
            .padding(.bottom, 6)
    }
}

struct VocifyField: View {
    var title: String
    @Binding var text: String
    var body: some View {
        TextField(title, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 14))
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(Vocify.paper)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Vocify.line))
    }
}

struct VocifySecret: View {
    var title: String
    @Binding var text: String
    var body: some View {
        SecureField(title, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 14))
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(Vocify.paper)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Vocify.line))
    }
}

struct VocifyStop: View {
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text("Parar")
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(hover ? Vocify.danger.opacity(0.88) : Vocify.danger)
                .clipShape(Capsule())
                .contentShape(Capsule())
                .background(HandCursor())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct RecordCore: NSViewRepresentable {
    var listening: Bool
    var busy: Bool
    var elapsed: String
    var action: () -> Void

    func makeNSView(context: Context) -> RecordCoreView {
        let view = RecordCoreView()
        view.onClick = action
        view.listening = listening
        view.busy = busy
        view.elapsed = elapsed
        return view
    }

    func updateNSView(_ view: RecordCoreView, context: Context) {
        view.onClick = action
        view.listening = listening
        view.busy = busy
        view.elapsed = elapsed
        view.needsDisplay = true
    }
}

final class RecordCoreView: NSView {
    var onClick: () -> Void = {}
    var listening = false
    var busy = false
    var elapsed = "00:00"
    private var hover = false

    override var intrinsicContentSize: NSSize { NSSize(width: 80, height: 96) }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect, .cursorUpdate],
            owner: self
        ))
    }

    override func cursorUpdate(with event: NSEvent) {
        NSCursor.pointingHand.set()
    }

    override func mouseEntered(with event: NSEvent) {
        hover = true
        NSCursor.pointingHand.set()
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        hover = false
        NSCursor.arrow.set()
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard !busy, bounds.contains(convert(event.locationInWindow, from: nil)) else { return }
        onClick()
    }

    override func draw(_ dirtyRect: NSRect) {
        let side: CGFloat = hover && !busy ? 84 : 80
        let origin = NSPoint(x: (bounds.width - side) / 2, y: bounds.height - side)
        let circle = NSRect(x: origin.x, y: origin.y, width: side, height: side)
        let fill = hover ? NSColor.white.withAlphaComponent(0.95) : NSColor.white.withAlphaComponent(0.8)
        fill.setFill()
        NSBezierPath(ovalIn: circle).fill()
        NSColor(calibratedRed: 0.42, green: 0.34, blue: 0.26, alpha: hover ? 0.45 : 0.25).setStroke()
        let ring = NSBezierPath(ovalIn: circle.insetBy(dx: 1, dy: 1))
        ring.lineWidth = 1
        ring.stroke()
        let dot: CGFloat = listening ? 16 : 28
        let dotRect = NSRect(
            x: circle.midX - dot / 2,
            y: circle.midY - dot / 2,
            width: dot,
            height: dot
        )
        if listening {
            NSColor(calibratedRed: 0.75, green: 0.22, blue: 0.2, alpha: 1).setFill()
            NSBezierPath(roundedRect: dotRect, xRadius: 3, yRadius: 3).fill()
        } else {
            NSColor(calibratedRed: 0.42, green: 0.34, blue: 0.26, alpha: 1).setFill()
            NSBezierPath(ovalIn: dotRect).fill()
        }
    }
}

struct RecordButton: View {
    var listening: Bool
    var busy: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(listening ? Vocify.danger : (hover ? Vocify.beige.opacity(0.14) : Vocify.paper))
                    .overlay(Circle().stroke(listening ? Vocify.danger : Vocify.beige, lineWidth: 1.5))
                if listening {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Vocify.paper)
                        .frame(width: 12, height: 12)
                } else {
                    Circle()
                        .fill(Vocify.danger)
                        .frame(width: 14, height: 14)
                }
            }
            .frame(width: 48, height: 48)
            .contentShape(Circle())
            .scaleEffect(hover && !busy ? 1.06 : 1)
            .animation(.easeOut(duration: 0.15), value: hover)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .onHover { inside in
            hover = inside
            if inside { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
        }
        .help(listening ? "Parar" : "Escuchar")
    }
}

struct HoverLink: View {
    var title: String
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(hover ? Vocify.ink : Vocify.mute)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { inside in
            hover = inside
            if inside { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
        }
    }
}

struct VocifyPrimary: View {
    var title: String
    var busy: Bool = false
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small) }
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
            }
                .foregroundStyle(Vocify.paper)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(hover && !busy ? Vocify.beige.opacity(0.86) : Vocify.beige)
                .clipShape(Capsule())
                .contentShape(Capsule())
                .background(HandCursor())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct HandCursor: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { HandCursorView() }
    func updateNSView(_ nsView: NSView, context: Context) {
        nsView.window?.invalidateCursorRects(for: nsView)
    }
}

final class HandCursorView: NSView {
    override func resetCursorRects() {
        discardCursorRects()
        addCursorRect(bounds, cursor: .pointingHand)
    }

    override func layout() {
        super.layout()
        window?.invalidateCursorRects(for: self)
    }
}

struct VocifyGhost: View {
    var title: String
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(hover ? Vocify.ink : Vocify.mute)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(hover ? Vocify.paper : Color.clear)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Vocify.line))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { inside in
            hover = inside
            if inside { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
        }
    }
}
