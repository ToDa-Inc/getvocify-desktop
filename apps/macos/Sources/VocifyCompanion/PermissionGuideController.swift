import AppKit
import AVFoundation
import ScreenCaptureKit

/// One-shot helper beside System Settings.
/// Screen & System Audio Recording often has no in-app prompt: macOS adds the app
/// only after a capture attempt (toggle off), or the user drops the .app onto the list.
@MainActor
final class PermissionGuideController: NSObject {
    static let shared = PermissionGuideController()

    private var panel: NSPanel?
    private var pollTimer: Timer?
    private var kind: Kind?
    private weak var bridge: DesktopBridge?
    private var pollCount = 0
    private let maxPolls = 90
    private var presenting = false

    enum Kind {
        case microphone
        case systemAudio

        var settingsAnchor: String {
            switch self {
            case .microphone: return "Privacy_Microphone"
            case .systemAudio: return "Privacy_ScreenCapture"
            }
        }
    }

    func present(_ kind: Kind, bridge: DesktopBridge?) async {
        if presenting || panel != nil {
            panel?.orderFrontRegardless()
            positionPanel()
            return
        }
        presenting = true
        defer { presenting = false }

        self.kind = kind
        self.bridge = bridge
        pollCount = 0

        switch kind {
        case .microphone:
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .audio)
            }
        case .systemAudio:
            await SystemAudioPermission.register()
        }

        if await isGranted(kind) {
            self.kind = nil
            bridge?.emitPermissionsChanged()
            return
        }

        await openSystemSettings(kind)
        panel = buildPanel(kind)
        positionPanel()
        panel?.orderFrontRegardless()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            guard let guide = self else { return }
            Task { @MainActor in guide.tick() }
        }
    }

    func dismiss() {
        pollTimer?.invalidate()
        pollTimer = nil
        panel?.orderOut(nil)
        panel = nil
        kind = nil
        pollCount = 0
    }

    private func tick() {
        guard let kind else { return }
        pollCount += 1
        positionPanel()
        if pollCount >= maxPolls {
            dismiss()
            return
        }
        Task {
            if await isGranted(kind) {
                dismiss()
                bridge?.emitPermissionsChanged()
            }
        }
    }

    private func isGranted(_ kind: Kind) async -> Bool {
        switch kind {
        case .microphone:
            return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        case .systemAudio:
            return CGPreflightScreenCaptureAccess()
        }
    }

    /// Launch System Settings first, then open the privacy page once it is on screen.
    /// Opening the deep link while Settings is still launching makes the pane flash and close.
    private func openSystemSettings(_ kind: Kind) async {
        let anchor = kind.settingsAnchor
        guard let deepLink = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)") else { return }
        let appURL = URL(fileURLWithPath: "/System/Applications/System Settings.app")
        if !FileManager.default.fileExists(atPath: appURL.path) {
            NSWorkspace.shared.open(deepLink)
            return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            NSWorkspace.shared.openApplication(at: appURL, configuration: config) { _, _ in
                cont.resume()
            }
        }
        for _ in 0..<12 {
            if Self.systemSettingsFrame() != nil { break }
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        try? await Task.sleep(nanoseconds: 400_000_000)
        NSWorkspace.shared.open(deepLink)
        try? await Task.sleep(nanoseconds: 250_000_000)
    }

    private func positionPanel() {
        guard let panel else { return }
        let size = panel.frame.size
        let target: NSPoint
        if let settings = Self.systemSettingsFrame() {
            target = NSPoint(x: settings.minX - size.width - 12, y: settings.midY - size.height / 2)
        } else if let screen = NSScreen.main {
            let area = screen.visibleFrame
            target = NSPoint(x: area.maxX - size.width - 24, y: area.midY - size.height / 2)
        } else {
            return
        }
        panel.setFrameOrigin(Self.clamped(target, size: size))
    }

    private static func clamped(_ origin: NSPoint, size: NSSize) -> NSPoint {
        let screen = NSScreen.screens.first { $0.visibleFrame.intersects(CGRect(origin: origin, size: size)) } ?? NSScreen.main
        guard let screen else { return origin }
        let area = screen.visibleFrame
        let x = min(max(origin.x, area.minX + 8), area.maxX - size.width - 8)
        let y = min(max(origin.y, area.minY + 8), area.maxY - size.height - 8)
        return NSPoint(x: x, y: y)
    }

    private func buildPanel(_ kind: Kind) -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 260, height: 210),
            styleMask: [.nonactivatingPanel, .fullSizeContentView, .hudWindow],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true

        let root = NSView(frame: panel.frame)
        root.wantsLayer = true
        root.layer?.cornerRadius = 16
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96).cgColor

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Drag Vocify into the list")
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        let body = NSTextField(wrappingLabelWithString:
            kind == .systemAudio
                ? "Drop it on Screen & System Audio Recording. If Vocify is already there but off, turn it on. Then quit Vocify and reopen."
                : "Drop it on Microphone, or turn Vocify on if it is already listed."
        )
        body.font = .systemFont(ofSize: 11)
        body.textColor = .secondaryLabelColor
        body.alignment = .center
        body.maximumNumberOfLines = 5

        let drag = AppBundleDragView(frame: NSRect(x: 0, y: 0, width: 72, height: 88))
        drag.translatesAutoresizingMaskIntoConstraints = false

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(body)
        stack.addArrangedSubview(drag)
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            drag.widthAnchor.constraint(equalToConstant: 72),
            drag.heightAnchor.constraint(equalToConstant: 88),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -12),
        ])
        panel.contentView = root
        return panel
    }

    private static func systemSettingsFrame() -> CGRect? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
        for window in list {
            guard let owner = window[kCGWindowOwnerName as String] as? String,
                  owner == "System Settings" || owner == "System Preferences",
                  let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = bounds["X"], let y = bounds["Y"],
                  let w = bounds["Width"], let h = bounds["Height"], w > 200, h > 200
            else { continue }
            return flipToAppKit(CGRect(x: x, y: y, width: w, height: h))
        }
        return nil
    }

    private static func flipToAppKit(_ cgRect: CGRect) -> CGRect {
        let primary = NSScreen.screens.first ?? NSScreen.main
        guard let primary else { return cgRect }
        let flippedY = primary.frame.maxY - cgRect.origin.y - cgRect.height
        return CGRect(x: cgRect.origin.x, y: flippedY, width: cgRect.width, height: cgRect.height)
    }
}

private final class AppBundleDragView: NSView, NSDraggingSource {
    private let iconView = NSImageView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.7).cgColor
        iconView.image = NSApp.applicationIconImage ?? NSImage(named: NSImage.applicationIconName)
        iconView.imageScaling = .scaleProportionallyUpOrDown
        addSubview(iconView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        iconView.frame = bounds.insetBy(dx: 8, dy: 8)
    }

    override func mouseDown(with event: NSEvent) {
        let url = Bundle.main.bundleURL as NSURL
        let item = NSDraggingItem(pasteboardWriter: url)
        let image = iconView.image ?? NSImage(size: bounds.size)
        item.setDraggingFrame(bounds, contents: image)
        beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }
}
