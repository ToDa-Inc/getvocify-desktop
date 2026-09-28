import AppKit
import AVFoundation
import ScreenCaptureKit

/// Codex-style guide: opens System Settings, floats a panel beside it, and exposes the
/// real .app bundle as a drag source so the user can drop Vocify into the permission list.
@MainActor
final class PermissionGuideController: NSObject {
    static let shared = PermissionGuideController()

    private var panel: NSPanel?
    private var pollTimer: Timer?
    private var kind: Kind?
    private weak var bridge: DesktopBridge?

    enum Kind: String {
        case microphone
        case systemAudio

        var settingsAnchor: String {
            switch self {
            case .microphone: return "Privacy_Microphone"
            case .systemAudio: return "Privacy_ScreenCapture"
            }
        }

        var headline: String {
            switch self {
            case .microphone: return "Drag Vocify to Microphone"
            case .systemAudio: return "Drag Vocify here"
            }
        }

        var body: String {
            switch self {
            case .microphone:
                return "Drop onto the list in System Settings, or toggle Vocify on."
            case .systemAudio:
                return "Drop onto Screen & System Audio Recording, or toggle Vocify on."
            }
        }
    }

    var isVisible: Bool { panel?.isVisible == true }

    func present(_ kind: Kind, bridge: DesktopBridge?) {
        dismiss()
        self.kind = kind
        self.bridge = bridge
        openSystemSettings(kind)
        panel = buildPanel(kind)
        panel?.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        tick()
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    func dismiss() {
        pollTimer?.invalidate()
        pollTimer = nil
        panel?.orderOut(nil)
        panel = nil
        kind = nil
    }

    private func tick() {
        guard let kind else { return }
        positionPanel()
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
            return await SystemAudioPermission.status() == "authorized"
        }
    }

    private func openSystemSettings(_ kind: Kind) {
        let anchor = kind.settingsAnchor
        for raw in [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)",
            "x-apple.systempreferences:com.apple.preference.security?\(anchor)",
        ] {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) { return }
        }
    }

    private func positionPanel() {
        guard let panel else { return }
        let size = NSSize(width: 280, height: 168)
        panel.setContentSize(size)
        if let settings = Self.systemSettingsFrame() {
            // Dock just left of the settings content, vertically centered on the list area.
            let x = settings.minX - size.width - 16
            let y = settings.midY - size.height / 2
            panel.setFrameOrigin(NSPoint(x: max(16, x), y: y))
        } else {
            if let screen = NSScreen.main {
                let area = screen.visibleFrame
                panel.setFrameOrigin(NSPoint(x: area.minX + 24, y: area.midY - size.height / 2))
            }
        }
    }

    private func buildPanel(_ kind: Kind) -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 280, height: 168),
            styleMask: [.nonactivatingPanel, .fullSizeContentView, .hudWindow],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true

        let root = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 168))
        root.wantsLayer = true
        root.layer?.cornerRadius = 16
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.92).cgColor
        root.layer?.borderWidth = 1
        root.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.35).cgColor

        let stack = NSStackView(frame: NSRect(x: 16, y: 16, width: 248, height: 136))
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: kind.headline)
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        title.alignment = .center

        let body = NSTextField(wrappingLabelWithString: kind.body)
        body.font = .systemFont(ofSize: 11)
        body.textColor = .secondaryLabelColor
        body.alignment = .center
        body.maximumNumberOfLines = 3

        let drag = AppBundleDragView(frame: NSRect(x: 0, y: 0, width: 72, height: 88))
        drag.translatesAutoresizingMaskIntoConstraints = false
        drag.heightAnchor.constraint(equalToConstant: 88).isActive = true
        drag.widthAnchor.constraint(equalToConstant: 72).isActive = true

        let dropHint = NSTextField(labelWithString: "Drop here →")
        dropHint.font = .systemFont(ofSize: 10, weight: .medium)
        dropHint.textColor = NSColor.systemRed.withAlphaComponent(0.85)

        stack.addArrangedSubview(title)
        stack.addArrangedSubview(body)
        stack.addArrangedSubview(drag)
        stack.addArrangedSubview(dropHint)

        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -12),
        ])

        panel.contentView = root
        return panel
    }

    /// Finds the frontmost System Settings window in screen coordinates (AppKit space).
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
            let cgRect = CGRect(x: x, y: y, width: w, height: h)
            return flipToAppKit(cgRect)
        }
        return nil
    }

    private static func flipToAppKit(_ cgRect: CGRect) -> CGRect {
        guard let screen = NSScreen.main else { return cgRect }
        let flippedY = screen.frame.height - cgRect.origin.y - cgRect.height
        return CGRect(x: cgRect.origin.x, y: flippedY, width: cgRect.width, height: cgRect.height)
    }
}

// MARK: - Real .app drag source (WK cannot do this)

private final class AppBundleDragView: NSView, NSDraggingSource {
    private let iconView = NSImageView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.6).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.separatorColor.cgColor

        iconView.image = NSApp.applicationIconImage ?? NSImage(named: NSImage.applicationIconName)
        iconView.imageScaling = .scaleProportionallyUpOrDown
        addSubview(iconView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        iconView.frame = NSRect(x: 10, y: 18, width: bounds.width - 20, height: bounds.width - 20)
    }

    override func mouseDown(with event: NSEvent) {
        guard let url = Bundle.main.bundleURL as NSURL? else { return }
        let draggingItem = NSDraggingItem(pasteboardWriter: url)
        let icon = iconView.image ?? NSImage(size: NSSize(width: 64, height: 64))
        draggingItem.setDraggingFrame(bounds, contents: icon)
        beginDraggingSession(with: [draggingItem], event: event, source: self)
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }
}
