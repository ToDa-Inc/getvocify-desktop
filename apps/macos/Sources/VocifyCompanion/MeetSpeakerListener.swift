import Foundation
import VocifyCore

/// Who Google Meet shows speaking, from the Vocify Chrome extension. The extension reads the Meet
/// page (no Accessibility needed) and Chrome hands each reading to `VocifyMeetHost`, which posts it
/// here. Granola names Meet speakers the same way, through its own extension.
@MainActor
final class MeetSpeakerListener {
    static let shared = MeetSpeakerListener()

    /// "Vocify - Voice to CRM" as installed from the Chrome Web Store.
    private static let extensionIDs = ["eaneblbmmpgdchcejlfhiiklpcolfclb"]
    /// Extra IDs for an unpacked extension during development: `defaults write com.vocify.app vocify.extensionIDs -array <id>`.
    private static let extraIDsKey = "vocify.extensionIDs"
    /// Chrome reads user-level host manifests from `<profile root>/NativeMessagingHosts` (Chrome's native messaging docs).
    private static let browserRoots = ["Google/Chrome", "Chromium"]

    /// Set by the recording in progress; nil when nothing records.
    var onSpeaking: ((MeetSpeaking) -> Void)?
    private var observer: NSObjectProtocol?

    func start() {
        guard observer == nil else { return }
        installHost()
        observer = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name(MeetSpeaking.notification), object: nil, queue: .main
        ) { [weak self] note in
            guard let text = note.object as? String, let speaking = MeetSpeaking.parse(Data(text.utf8)) else { return }
            MainActor.assumeIsolated { self?.onSpeaking?(speaking) }
        }
    }

    /// Tells Chrome where the host is; rewritten at each launch, so a moved app keeps working.
    private func installHost() {
        let host = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/VocifyMeetHost")
        let ids = Self.extensionIDs + (UserDefaults.standard.stringArray(forKey: Self.extraIDsKey) ?? [])
        guard FileManager.default.isExecutableFile(atPath: host.path), ids.contains(where: NativeHost.isExtensionID) else { return }
        let manifest = NativeHost.manifest(path: host.path, extensionIDs: ids)
        let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        for root in Self.browserRoots {
            let browser = support.appendingPathComponent(root, isDirectory: true)
            guard FileManager.default.fileExists(atPath: browser.path) else { continue }
            let folder = browser.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
            let file = folder.appendingPathComponent("\(NativeHost.name).json")
            guard (try? Data(contentsOf: file)) != manifest else { continue }
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try? manifest.write(to: file, options: .atomic)
        }
    }
}
