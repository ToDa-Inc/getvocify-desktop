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

    private func tick() {
        let started = ContinuousClock.now
        let urls = CrmPageReader.readFrontmost()
        let took = (ContinuousClock.now - started).components
        let ms = took.seconds * 1000 + took.attoseconds / 1_000_000_000_000_000
        Self.log.debug("read \(ms, privacy: .public) ms")
        // nil: not allowed to read this browser, or it went away. Nothing new to say.
        guard let urls, let changed = change.next(urls) else { return }
        bridge?.emitCrmScreen(changed)
    }
}
