import AppKit
import ApplicationServices
import VocifyCore

/// Who the meeting app shows as speaking right now, read from its window through macOS
/// Accessibility (the way Granola names speakers): the call's audio mixes everyone together,
/// but the app on screen knows who is talking. Only names leave this file.
///
/// Zoom: in the "Zoom Meeting" window each video tile is described as
/// "Name, Computer audio, Active speaker" (same reading as lucassynnott/meeting-notes,
/// native/zoom-observer). Other apps return nil until their screens are mapped from a real call.
enum ActiveSpeakers {
    /// Asks once for Accessibility; afterwards macOS remembers the answer.
    static func ensureTrusted(prompt: Bool) -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func supports(_ bundleID: String?) -> Bool {
        bundleID == "us.zoom.xos"
    }

    /// The names shown as speaking, [] when nobody is, nil when the app can't be read.
    static func read(bundleID: String?) -> [String]? {
        guard AXIsProcessTrusted(), let bundleID, supports(bundleID),
              let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { return nil }
        return zoom(AXUIElementCreateApplication(app.processIdentifier))
    }

    // MARK: Zoom

    private static func zoom(_ app: AXUIElement) -> [String]? {
        let windows = children(app).filter { string($0, kAXRoleAttribute) == kAXWindowRole }
        guard let meeting = windows.first(where: { string($0, kAXTitleAttribute)?.lowercased().hasPrefix("zoom meeting") == true }) else {
            return nil
        }
        var speaking = Set<String>()
        var queue: [(AXUIElement, Int)] = [(meeting, 0)]
        var visited = 0
        while !queue.isEmpty, visited < 1500 {
            let (element, depth) = queue.removeFirst()
            visited += 1
            if let description = string(element, kAXDescriptionAttribute) {
                if let name = ZoomTile.speakingName(description) { speaking.insert(name) }
                SpeakerProbe.note(description)
            }
            if depth < 5 { queue.append(contentsOf: children(element).map { ($0, depth + 1) }) }
        }
        return speaking.sorted()
    }

    /// Off unless `defaults write com.vocify.app vocify.speakerProbe -bool YES`: logs each distinct
    /// description in the Zoom meeting window to ~/Library/Logs/Vocify/speakers.log, so a real call
    /// shows what Zoom exposes (e.g. whether tiles ever say "active speaker").
    private enum SpeakerProbe {
        private static let on = UserDefaults.standard.bool(forKey: "vocify.speakerProbe")
        private static var seen = Set<String>()
        private static let lock = NSLock()
        private static let file = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Vocify/speakers.log")

        static func note(_ description: String) {
            guard on else { return }
            lock.lock()
            defer { lock.unlock() }
            guard seen.insert(description).inserted else { return }
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            let line = Data("\(ISO8601DateFormatter().string(from: Date())) \(description)\n".utf8)
            if let handle = try? FileHandle(forWritingTo: file) {
                handle.seekToEndOfFile()
                handle.write(line)
                try? handle.close()
            } else {
                try? line.write(to: file)
            }
        }
    }

    // MARK: AX helpers

    private static func children(_ element: AXUIElement) -> [AXUIElement] {
        var value: AnyObject?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
        return value as? [AXUIElement] ?? []
    }

    private static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: AnyObject?
        AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return value as? String
    }
}
