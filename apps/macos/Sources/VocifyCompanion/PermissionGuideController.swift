import AppKit
import AVFoundation
import ScreenCaptureKit

/// Codex-style guide when the app is properly signed. Ad-hoc builds cannot appear in
/// System Settings (Apple TN3127) — we show a blocking explanation instead.
@MainActor
final class PermissionGuideController: NSObject {
    static let shared = PermissionGuideController()

    private var panel: NSPanel?
    private var pollTimer: Timer?
    private var kind: Kind?
    private weak var bridge: DesktopBridge?
    private var pollCount = 0
    private let maxPolls = 120 // ~54s then stop nagging

    enum Kind: String {
        case microphone
        case systemAudio

        var settingsAnchor: String {
            switch self {
            case .microphone: return "Privacy_Microphone"
            case .systemAudio: return "Privacy_ScreenCapture"
            }
        }
    }

    var isVisible: Bool { panel?.isVisible == true }

    func present(_ kind: Kind, bridge: DesktopBridge?) {
        dismiss()
        self.kind = kind
        self.bridge = bridge
        pollCount = 0

        if AppSigning.info().isAdHoc {
            panel = buildAdHocPanel()
            panel?.orderFrontRegardless()
            return
        }

        if kind == .systemAudio {
            _ = SystemAudioPermission.requestSystemPrompt()
        } else if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            Task { _ = await AVCaptureDevice.requestAccess(for: .audio) }
        }

        openSystemSettings(kind)
        panel = buildGuidePanel(kind)
        panel?.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        tick()
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
        let size = panel.frame.size
        if let settings = Self.systemSettingsFrame() {
            let x = settings.minX - size.width - 16
            let y = settings.midY - size.height / 2
            panel.setFrameOrigin(NSPoint(x: max(16, x), y: y))
        } else if let screen = NSScreen.main {
            let area = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: area.minX + 24, y: area.midY - size.height / 2))
        }
    }

    private func buildAdHocPanel() -> NSPanel {
        let panel = makePanel(width: 320, height: 220)
        let text = NSTextField(wrappingLabelWithString:
            """
            This build is unsigned (ad-hoc). macOS will not list Vocify under \
            Screen & System Audio Recording, so there is nothing to toggle in Settings.

            Create a Code Signing certificate in Keychain (see DEVELOPMENT.md), then rebuild:

            CODESIGN_IDENTITY="Vocify Dev" ./scripts/dev-desktop.sh
            """
        )
        text.font = .systemFont(ofSize: 12)
        text.textColor = .labelColor
        layoutPanel(panel, title: "Signing required", body: text, showDrag: false)
        return panel
    }

    private func buildGuidePanel(_ kind: Kind) -> NSPanel {
        let panel = makePanel(width: 280, height: 180)
        let body = NSTextField(wrappingLabelWithString:
            kind == .systemAudio
                ? "Drop Vocify onto Screen & System Audio Recording, or toggle it on."
                : "Drop Vocify onto the Microphone list, or toggle it on."
        )
        body.font = .systemFont(ofSize: 11)
        body.textColor = .secondaryLabelColor
        layoutPanel(panel, title: "Drag Vocify here", body: body, showDrag: true)
        return panel
    }

    private func makePanel(width: CGFloat, height: CGFloat) -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
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
        return panel
    }

    private func layoutPanel(_ panel: NSPanel, title: String, body: NSTextField, showDrag: Bool) {
        let root = NSView(frame: panel.frame)
        root.wantsLayer = true
        root.layer?.cornerRadius = 16
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.95).cgColor

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        let titleField = NSTextField(labelWithString: title)
        titleField.font = .systemFont(ofSize: 14, weight: .semibold)
        stack.addArrangedSubview(titleField)
        stack.addArrangedSubview(body)
        if showDrag {
            let drag = AppBundleDragView(frame: NSRect(x: 0, y: 0, width: 72, height: 88))
            drag.translatesAutoresizingMaskIntoConstraints = false
            drag.heightAnchor.constraint(equalToConstant: 88).isActive = true
            drag.widthAnchor.constraint(equalToConstant: 72).isActive = true
            stack.addArrangedSubview(drag)
        }

        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -12),
        ])
        panel.contentView = root
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
        guard let screen = NSScreen.main else { return cgRect }
        let flippedY = screen.frame.height - cgRect.origin.y - cgRect.height
        return CGRect(x: cgRect.origin.x, y: flippedY, width: cgRect.width, height: cgRect.height)
    }
}

private final class AppBundleDragView: NSView, NSDraggingSource {
    private let iconView = NSImageView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.6).cgColor
        iconView.image = NSApp.applicationIconImage ?? NSImage(named: NSImage.applicationIconName)
        iconView.imageScaling = .scaleProportionallyUpOrDown
        addSubview(iconView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        iconView.frame = bounds.insetBy(dx: 10, dy: 10)
    }

    override func mouseDown(with event: NSEvent) {
        guard let url = Bundle.main.bundleURL as NSURL? else { return }
        let draggingItem = NSDraggingItem(pasteboardWriter: url)
        draggingItem.setDraggingFrame(bounds, contents: iconView.image)
        beginDraggingSession(with: [draggingItem], event: event, source: self)
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }
}
