import AppKit
import os
import VocifyCore

/// Keeps the dashboard told which CRM record is in the frontmost browser (`crm:screen`), so the
/// island can offer to call it. Reads only while a supported browser is in front: once when it
/// comes forward, then every 1.5 s. Another app in front changes nothing (the last record stays).
@MainActor
final class CrmScreenWatcher {
    static let shared = CrmScreenWatcher()
    nonisolated static let log = Logger(subsystem: "com.vocify.app", category: "crm-screen")

    private weak var bridge: DesktopBridge?
    private var observer: NSObjectProtocol?
    private var timer: Timer?
    private var change = CrmScreenChange()

    func start(bridge: DesktopBridge) {
        self.bridge = bridge
        guard observer == nil else { return }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            let bundleID = app?.bundleIdentifier
            MainActor.assumeIsolated { self?.frontmostChanged(bundleID) }
        }
        frontmostChanged(NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
    }

    private func frontmostChanged(_ bundleID: String?) {
        timer?.invalidate()
        timer = nil
        guard let bundleID, CrmPages.browser(bundleID: bundleID) != nil else { return }
        tick()
        let next = Timer(timeInterval: 1.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        next.tolerance = 0.3
        RunLoop.main.add(next, forMode: .common)
        timer = next
    }

    /// A read still running when the next tick comes is never stacked.
    private var reading = false

    private func tick() {
        guard !reading, let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return }
        reading = true
        let started = ContinuousClock.now
        Task { @MainActor [weak self] in
            let urls = await CrmPageReader.readFront(bundleID: bundleID)
            guard let self else { return }
            self.reading = false
            let took = (ContinuousClock.now - started).components
            Self.log.debug("read \(took.seconds * 1000 + took.attoseconds / 1_000_000_000_000_000, privacy: .public) ms (off the main thread)")
            // nil: not allowed to read this browser, or it went away. Nothing new to say.
            guard let urls, let changed = self.change.next(urls) else { return }
            let shown = changed.first.flatMap { URL(string: $0).map { "\($0.host ?? "")\($0.path)" } } ?? "none"
            Self.log.debug("crm:screen \(shown, privacy: .public)")
            self.bridge?.emitCrmScreen(changed)
        }
    }
}
