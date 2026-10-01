import AppKit
import Carbon.HIToolbox

/// A global keyboard shortcut that starts and stops recording from any app, set in the
/// dashboard's Settings. Carbon hot keys need no Accessibility permission and only fire for
/// the exact combination, so typing elsewhere is never watched.
@MainActor
final class RecordShortcut {
    static let shared = RecordShortcut()

    struct Combo: Equatable {
        let keyCode: UInt32
        let modifiers: UInt32 // Carbon: cmdKey, optionKey, controlKey, shiftKey
        let key: String

        var label: String {
            var out = ""
            if modifiers & UInt32(controlKey) != 0 { out += "⌃" }
            if modifiers & UInt32(optionKey) != 0 { out += "⌥" }
            if modifiers & UInt32(shiftKey) != 0 { out += "⇧" }
            if modifiers & UInt32(cmdKey) != 0 { out += "⌘" }
            return out + key
        }
    }

    /// ⌥⌘R: "Record", free in the apps reps take calls in.
    static let defaultCombo = Combo(keyCode: UInt32(kVK_ANSI_R), modifiers: UInt32(optionKey | cmdKey), key: "R")
    private static let storeKey = "vocify.recordShortcut"

    var onPress: (() -> Void)?
    private(set) var combo: Combo?
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?

    /// Registers the saved shortcut (the default the first time).
    func activate() {
        installHandler()
        let saved = Self.load()
        if let saved, !register(saved) { combo = nil }
    }

    enum SetResult { case ok(Combo), invalid, taken }

    /// From the dashboard's key event (`KeyboardEvent.code` and modifier flags).
    func set(code: String, command: Bool, option: Bool, control: Bool, shift: Bool) -> SetResult {
        guard let key = Self.keys[code] else { return .invalid }
        var modifiers: UInt32 = 0
        if command { modifiers |= UInt32(cmdKey) }
        if option { modifiers |= UInt32(optionKey) }
        if control { modifiers |= UInt32(controlKey) }
        if shift { modifiers |= UInt32(shiftKey) }
        // A plain key would fire while typing anywhere; function keys may stand alone.
        let functionKey = code.hasPrefix("F") && code.count > 1 && Int(code.dropFirst()) != nil
        guard functionKey || modifiers & UInt32(cmdKey | optionKey | controlKey) != 0 else { return .invalid }
        let next = Combo(keyCode: key.code, modifiers: modifiers, key: key.label)
        let previous = combo
        unregister()
        guard register(next) else {
            if let previous { register(previous) }
            return .taken
        }
        Self.save(next)
        return .ok(next)
    }

    func clear() {
        unregister()
        combo = nil
        UserDefaults.standard.set(["off": true], forKey: Self.storeKey)
    }

    @discardableResult
    private func register(_ next: Combo) -> Bool {
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x5643_4659), id: 1) // "VCFY"
        let status = RegisterEventHotKey(next.keyCode, next.modifiers, id, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        hotKey = ref
        combo = next
        return true
    }

    private func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
    }

    private func installHandler() {
        guard handler == nil else { return }
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { RecordShortcut.shared.onPress?() }
            }
            return noErr
        }, 1, &type, nil, &handler)
    }

    private static func load() -> Combo? {
        guard let raw = UserDefaults.standard.dictionary(forKey: storeKey) else { return defaultCombo }
        if raw["off"] as? Bool == true { return nil }
        guard let code = raw["keyCode"] as? Int, let modifiers = raw["modifiers"] as? Int, let key = raw["key"] as? String else {
            return defaultCombo
        }
        return Combo(keyCode: UInt32(code), modifiers: UInt32(modifiers), key: key)
    }

    private static func save(_ combo: Combo) {
        UserDefaults.standard.set(
            ["keyCode": Int(combo.keyCode), "modifiers": Int(combo.modifiers), "key": combo.key],
            forKey: storeKey
        )
    }

    /// `KeyboardEvent.code` → macOS virtual key and how it reads.
    private static let keys: [String: (code: UInt32, label: String)] = {
        var map: [String: (UInt32, String)] = [:]
        let letters: [(String, Int)] = [
            ("A", kVK_ANSI_A), ("B", kVK_ANSI_B), ("C", kVK_ANSI_C), ("D", kVK_ANSI_D), ("E", kVK_ANSI_E),
            ("F", kVK_ANSI_F), ("G", kVK_ANSI_G), ("H", kVK_ANSI_H), ("I", kVK_ANSI_I), ("J", kVK_ANSI_J),
            ("K", kVK_ANSI_K), ("L", kVK_ANSI_L), ("M", kVK_ANSI_M), ("N", kVK_ANSI_N), ("O", kVK_ANSI_O),
            ("P", kVK_ANSI_P), ("Q", kVK_ANSI_Q), ("R", kVK_ANSI_R), ("S", kVK_ANSI_S), ("T", kVK_ANSI_T),
            ("U", kVK_ANSI_U), ("V", kVK_ANSI_V), ("W", kVK_ANSI_W), ("X", kVK_ANSI_X), ("Y", kVK_ANSI_Y),
            ("Z", kVK_ANSI_Z),
        ]
        for (letter, code) in letters { map["Key\(letter)"] = (UInt32(code), letter) }
        let digits = [kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
        for (digit, code) in digits.enumerated() { map["Digit\(digit)"] = (UInt32(code), "\(digit)") }
        let functions = [kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10, kVK_F11, kVK_F12,
                         kVK_F13, kVK_F14, kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19]
        for (index, code) in functions.enumerated() { map["F\(index + 1)"] = (UInt32(code), "F\(index + 1)") }
        map["Space"] = (UInt32(kVK_Space), "Space")
        map["Period"] = (UInt32(kVK_ANSI_Period), ".")
        map["Comma"] = (UInt32(kVK_ANSI_Comma), ",")
        map["Slash"] = (UInt32(kVK_ANSI_Slash), "/")
        map["Semicolon"] = (UInt32(kVK_ANSI_Semicolon), ";")
        map["Quote"] = (UInt32(kVK_ANSI_Quote), "'")
        map["BracketLeft"] = (UInt32(kVK_ANSI_LeftBracket), "[")
        map["BracketRight"] = (UInt32(kVK_ANSI_RightBracket), "]")
        map["Backquote"] = (UInt32(kVK_ANSI_Grave), "`")
        map["Minus"] = (UInt32(kVK_ANSI_Minus), "-")
        map["Equal"] = (UInt32(kVK_ANSI_Equal), "=")
        return map.mapValues { (code: $0.0, label: $0.1) }
    }()
}
