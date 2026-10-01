import AppKit
import CoreAudio

/// Notices a call starting: another app holding the microphone for a few seconds.
/// Reads CoreAudio state only; nothing is captured until the rep presses Record.
@MainActor
final class MicActivityMonitor {
    struct Caller: Equatable {
        let name: String?
        let bundleID: String?
    }

    /// Dictation and Siri hold the mic briefly; a call holds it longer.
    private static let settle: TimeInterval = 3
    private static let poll: TimeInterval = 1

    var onCall: ((Caller?) -> Void)?

    private var timer: Timer?
    private var since: Date?
    private var reported: Caller?
    private var didReport = false

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Self.poll, repeats: true) { [weak self] _ in
            guard let monitor = self else { return }
            MainActor.assumeIsolated { monitor.tick() }
        }
    }

    private func tick() {
        let caller = Self.currentCaller()
        if caller == nil {
            since = nil
        } else if since == nil {
            since = Date()
        }
        let settled = since.map { Date().timeIntervalSince($0) >= Self.settle } ?? false
        let next: Caller? = settled ? caller : nil
        if !didReport || reported != next {
            didReport = true
            reported = next
            onCall?(next)
        }
    }

    /// The app using the mic, or nil when only Vocify or the system is listening.
    private static func currentCaller() -> Caller? {
        if #available(macOS 14.2, *) {
            return processCaller()
        }
        return defaultInputRunning() ? Caller(name: nil, bundleID: nil) : nil
    }

    @available(macOS 14.2, *)
    private static func processCaller() -> Caller? {
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let ownBundle = Bundle.main.bundleIdentifier ?? ""
        for process in objects(kAudioHardwarePropertyProcessObjectList) {
            guard uint32(process, kAudioProcessPropertyIsRunningInput) == 1 else { continue }
            let pid = pid_t(bitPattern: uint32(process, kAudioProcessPropertyPID) ?? 0)
            let bundle = string(process, kAudioProcessPropertyBundleID) ?? ""
            if pid == ownPID || (!ownBundle.isEmpty && bundle.hasPrefix(ownBundle)) { continue }
            // Only calls: note-takers and dictation (Granola, Fathom, Wispr Flow) hold the mic too.
            guard isCallApp(bundle) else { continue }
            let app = owningApp(bundle: bundle, pid: pid)
            // Zoom's app is literally named "zoom.us".
            let name = app?.bundleIdentifier == "us.zoom.xos" ? "Zoom" : app?.localizedName
            return Caller(name: name, bundleID: app?.bundleIdentifier)
        }
        return nil
    }

    /// Apps people take calls in. Browsers count for Meet and other web calls; Safari's
    /// capture runs in WebKit's own process. Matched with their helper processes.
    private static let callApps = [
        "us.zoom.xos", "com.microsoft.teams2", "com.microsoft.teams", "com.tinyspeck.slackmacgap",
        "com.apple.FaceTime", "net.whatsapp.WhatsApp", "ru.keepcoder.Telegram", "com.hnc.Discord",
        "Cisco-Systems.Spark", "com.google.Chrome", "com.apple.Safari", "com.apple.WebKit",
        "company.thebrowser.Browser", "com.microsoft.edgemac", "org.mozilla.firefox", "com.brave.Browser",
    ]

    private static func isCallApp(_ bundle: String) -> Bool {
        callApps.contains { bundle == $0 || bundle.hasPrefix($0 + ".") }
    }

    /// Browsers capture from a helper process; name the browser, not "Google Chrome Helper".
    private static func owningApp(bundle: String, pid: pid_t) -> NSRunningApplication? {
        let running = NSWorkspace.shared.runningApplications
        if let app = running.first(where: { $0.processIdentifier == pid }), app.activationPolicy == .regular {
            return app
        }
        guard !bundle.isEmpty else { return nil }
        return running
            .filter { $0.activationPolicy == .regular }
            .filter { app in app.bundleIdentifier.map { bundle == $0 || bundle.hasPrefix($0 + ".") } ?? false }
            .max { ($0.bundleIdentifier?.count ?? 0) < ($1.bundleIdentifier?.count ?? 0) }
    }

    private static func defaultInputRunning() -> Bool {
        guard let device = objects(kAudioHardwarePropertyDefaultInputDevice).first else { return false }
        return uint32(device, kAudioDevicePropertyDeviceIsRunningSomewhere) == 1
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func objects(_ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
        var address = address(selector)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids
    }

    private static func uint32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
        var address = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
    }

    private static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }
}
