import AppKit
import SwiftUI

/// Legacy SwiftUI capture screen only (VOCIFY_USE_LEGACY_UI=1); the dashboard uses MeetingPill.
/// Borderless panels refuse key status by default, which makes the first click on Stop a no-op.
private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
final class OverlayPanelController {
    static let shared = OverlayPanelController()
    private var panel: NSPanel?

    func show(_ model: CompanionModel) {
        let panel = ensure()
        let host = panel.contentView as? NSHostingView<OverlayPill>
        if let host {
            host.rootView = OverlayPill(model: model)
        } else {
            panel.contentView = NSHostingView(rootView: OverlayPill(model: model))
        }
        if let screen = NSScreen.main {
            let area = screen.visibleFrame
            let width: CGFloat = model.sayThis.isEmpty && model.note.turns.isEmpty ? 72 : 320
            panel.setContentSize(NSSize(width: width, height: 64))
            panel.setFrameOrigin(NSPoint(x: area.maxX - width - 24, y: area.minY + 24))
        }
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func ensure() -> NSPanel {
        if let panel { return panel }
        let panel = OverlayPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 64),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        self.panel = panel
        return panel
    }
}

struct OverlayPill: View {
    @ObservedObject var model: CompanionModel

    var body: some View {
        HStack(spacing: 12) {
            RecordButton(listening: true, busy: model.busy) {
                Task { await model.stopAndReview() }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(line)
                    .font(.system(size: 14))
                    .foregroundStyle(Vocify.ink)
                    .lineLimit(2)
                if !model.checklist.isEmpty {
                    Text(model.checklist)
                        .font(.system(size: 11))
                        .foregroundStyle(Vocify.mute)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
    }

    private var line: String {
        if !model.sayThis.isEmpty { return model.sayThis }
        return model.note.turns.last?.text ?? ""
    }
}
