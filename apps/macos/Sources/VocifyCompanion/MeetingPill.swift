import AppKit
import SwiftUI
import VocifyCore

/// What the dashboard streams to the notch island through `shell:state`.
@MainActor
final class MeetingPillState: ObservableObject {
    struct Turn: Identifiable, Equatable {
        let id: String
        let you: Bool
        let label: String?
        let text: String
        let pending: String
    }

    /// Meeting time is kept here, not streamed: the web view's timers stall while Vocify is behind the call.
    struct Clock: Equatable {
        let startedAt: Date
        let paused: TimeInterval
        let pausedAt: Date?

        func elapsed(at now: Date) -> TimeInterval {
            max(0, (pausedAt ?? now).timeIntervalSince(startedAt) - paused)
        }

        /// Ticks land on whole seconds of meeting time, so no second is skipped or shown twice.
        var tickOrigin: Date { startedAt.addingTimeInterval(paused) }
    }

    struct Assist: Equatable {
        let label: String
        let isQuestion: Bool
        /** True while the answer is still being written: only the bridge line is known. */
        let drafting: Bool
        let bridge: String
        let sayThis: String
        let thenAsk: String
    }

    struct Countdown: Equatable {
        let total: TimeInterval
        var remaining: TimeInterval
        /// nil while the pointer holds it open.
        var runningSince: Date?

        func fraction(at now: Date) -> Double {
            let left = remaining - (runningSince.map { now.timeIntervalSince($0) } ?? 0)
            return max(0, min(1, left / total))
        }
    }

    enum Mode: Equatable {
        /// Always there: the Vocify mark beside the camera; click it to record.
        case idle
        /// Another app holds the mic: offer to record, record nothing yet.
        case call(MicActivityMonitor.Caller)
        case starting
        case recording
        /// Just stopped: paused, ending once the grace runs out unless the rep resumes.
        case stopped(StopGrace)
        /// The call is over: its memo is being written, then its CRM update is one click away.
        case postCall

        var isStopped: Bool {
            if case .stopped = self { return true }
            return false
        }
    }

    /// What the dashboard says about the call that just ended. Every part comes from something
    /// the backend produced for that call; a part that doesn't apply is nil.
    struct LiveType: Equatable {
        let selected: String?
        /// `selected` is still Vocify's proposal, not the rep's pick.
        let proposed: Bool
        let options: [PostCall.CallType.Option]

        var menu: TypeMenu {
            TypeMenu(options: options.map { TypeMenu.Option(key: $0.key, label: $0.label) }, selected: selected, proposed: proposed)
        }

        init(selected: String?, proposed: Bool, options: [PostCall.CallType.Option]) {
            self.selected = selected
            self.proposed = proposed
            self.options = options
        }

        init?(_ raw: [String: Any]) {
            let options = (raw["options"] as? [[String: Any]] ?? []).compactMap { option -> PostCall.CallType.Option? in
                guard let key = option["key"] as? String, let label = option["label"] as? String else { return nil }
                return PostCall.CallType.Option(key: key, label: label)
            }
            guard !options.isEmpty else { return nil }
            self.init(selected: raw["selected"] as? String, proposed: raw["proposed"] as? Bool ?? false, options: options)
        }
    }

    struct PostCall: Equatable {
        enum Stage: String {
            /// `internal`: a conversation without a customer; nothing goes to the CRM.
            case writing, ready, applying, done, review, `internal`
        }

        struct Change: Equatable, Identifiable {
            struct Option: Equatable, Identifiable {
                let value: String
                let label: String
                var id: String { value }
            }

            /// `object_type:field_name`, the key Vocify's review omits fields by.
            let key: String
            let label: String
            /// The record it lands on: contact, company, deal or other.
            let object: String
            /// As the rep reads them (option labels).
            let from: String?
            let to: String
            /// What gets written: the option value(s), ";"-joined for a checkbox list.
            let value: String
            /// Picked from in place; empty for free text, which is edited in Vocify.
            let options: [Option]
            let multiple: Bool
            /// Scored under "needs review": shown, unticked.
            let check: Bool
            var id: String { key }

            /// Option values, as the rep picked them or as extracted.
            func values(_ edited: String?) -> [String] {
                let raw = edited ?? value
                return multiple ? raw.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } : [raw]
            }

            /// What the CRM has, when it differs from what will be written.
            func before(_ shown: String) -> String? { from == shown ? nil : from }

            /// What the rep reads for the current pick.
            func shown(_ edited: String?) -> String {
                guard let edited, !options.isEmpty else { return to }
                let labels = values(edited).map { value in options.first { $0.value == value }?.label ?? value }
                return labels.isEmpty ? "—" : labels.joined(separator: ", ")
            }
        }

        struct Email: Equatable {
            enum State: String { case ready, skipped, sent }
            let state: State
            let to: String?
            let subject: String?
            /// The draft's opening.
            let preview: String?
        }

        struct Meeting: Equatable {
            enum State: String { case pending, check, added }
            let state: State
            let when: String?
        }

        /// What kind of call it was (its playbook), and what it can be changed to.
        struct CallType: Equatable {
            struct Option: Equatable, Identifiable {
                let key: String
                let label: String
                var id: String { key }
            }

            let key: String
            let label: String
            let options: [Option]
        }

        let stage: Stage
        let memoId: String
        let contactName: String?
        let changes: [Change]
        let canApprove: Bool
        let applied: Int?
        let undoUntil: Date?
        let note: String?
        let email: Email?
        let meeting: Meeting?
        let notes: Bool
        /// The note's first lines, plain text.
        let summary: String?
        /// The connected CRM's name; the card says "the CRM" when it isn't known.
        let crm: String?
        let offerStopEmails: Bool
        let type: CallType?

        var crmName: String { crm ?? "the CRM" }

        init?(_ raw: [String: Any]) {
            guard let stage = (raw["stage"] as? String).flatMap(Stage.init(rawValue:)),
                  let memoId = raw["memoId"] as? String else { return nil }
            self.stage = stage
            self.memoId = memoId
            contactName = (raw["contactName"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            changes = (raw["changes"] as? [[String: Any]] ?? []).compactMap { item in
                guard let key = item["key"] as? String, let to = item["to"] as? String else { return nil }
                let options = (item["options"] as? [[String: Any]] ?? []).compactMap { option -> Change.Option? in
                    guard let value = option["value"] as? String, !value.isEmpty else { return nil }
                    return Change.Option(value: value, label: option["label"] as? String ?? value)
                }
                return Change(
                    key: key,
                    label: item["label"] as? String ?? key,
                    object: item["object"] as? String ?? "other",
                    from: (item["from"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                    to: to,
                    value: item["value"] as? String ?? to,
                    options: options,
                    multiple: !options.isEmpty && (item["multiple"] as? Bool ?? false),
                    check: item["check"] as? Bool ?? false
                )
            }
            canApprove = raw["canApprove"] as? Bool ?? false
            applied = raw["applied"] as? Int
            undoUntil = (raw["undoUntil"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
            note = (raw["note"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            func text(_ value: Any?) -> String? {
                (value as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
            }
            email = (raw["email"] as? [String: Any]).flatMap { item in
                (item["state"] as? String).flatMap(Email.State.init(rawValue:)).map {
                    Email(state: $0, to: text(item["to"]), subject: text(item["subject"]), preview: text(item["preview"]))
                }
            }
            meeting = (raw["meeting"] as? [String: Any]).flatMap { item in
                (item["state"] as? String).flatMap(Meeting.State.init(rawValue:)).map {
                    Meeting(state: $0, when: item["when"] as? String)
                }
            }
            notes = raw["notes"] as? Bool ?? false
            summary = text(raw["summary"])
            crm = text(raw["crm"])
            offerStopEmails = raw["offerStopEmails"] as? Bool ?? false
            type = (raw["type"] as? [String: Any]).flatMap { item in
                guard let key = item["key"] as? String, let label = item["label"] as? String else { return nil }
                let options = (item["options"] as? [[String: Any]] ?? []).compactMap { option -> CallType.Option? in
                    guard let key = option["key"] as? String, let label = option["label"] as? String else { return nil }
                    return CallType.Option(key: key, label: label)
                }
                return CallType(key: key, label: label, options: options)
            }
        }


        /// What still needs the rep; the count on the closed island.
        var pending: Int {
            (stage == .ready || stage == .review ? 1 : 0)
                + (email?.state == .ready ? 1 : 0)
                + (meeting.map { $0.state != .added } == true ? 1 : 0)
        }
    }

    /// What the open card shows: the CRM changes, the email draft or the call's note.
    enum PostCallTab: Hashable { case crm, email, notes }

    /// Fixed sizes, so the island's height is exact and nothing jumps when a row arrives.
    /// A change's value wraps to two lines at most; its row height is measured from the text.
    enum PostCallLayout {
        static let width: CGFloat = 420
        static let inset: CGFloat = 16
        static let top: CGFloat = 6
        static let header: CGFloat = 26
        static let tabs: CGFloat = 26
        static let gap: CGFloat = 8
        static let line: CGFloat = 30
        static let groupLabel: CGFloat = 20
        static let rowPadding: CGFloat = 8
        /// The changes scroll inside the card past this; every one stays reachable.
        static let listMax: CGFloat = 236
        static let actions: CGFloat = 40
        static let meeting: CGFloat = 26
        static let bottom: CGFloat = 10
        static let tick: CGFloat = 14
        static let label: CGFloat = 104
        static let chevron: CGFloat = 14
        static let rowInset: CGFloat = 6
        /// Every value column has the same width, so the measured height is the drawn one.
        static let valueWidth: CGFloat = width - inset * 2 - rowInset * 2 - tick - label - chevron - 16
        static let valueSize: CGFloat = 12
        static let emailLines = 3
        static let noteLines = 5
        /// A change's options float under its value, over the card.
        static let option: CGFloat = 26
        static let optionsVisible = 7
        static let optionsPadding: CGFloat = 4

        static func optionsSize(_ change: PostCall.Change) -> CGSize {
            CGSize(
                width: valueWidth + chevron + optionsPadding * 2,
                height: CGFloat(min(change.options.count, optionsVisible)) * option + optionsPadding * 2
            )
        }

        static func lineHeight(_ size: CGFloat) -> CGFloat {
            let font = NSFont.systemFont(ofSize: size)
            return ceil(font.ascender - font.descender + font.leading)
        }

        /// Lines `text` takes at `width`, up to `limit`.
        static func lines(_ text: String, size: CGFloat, width: CGFloat, limit: Int) -> Int {
            guard !text.isEmpty else { return 1 }
            let rect = (text as NSString).boundingRect(
                with: CGSize(width: width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: NSFont.systemFont(ofSize: size)]
            )
            return min(limit, max(1, Int((rect.height / lineHeight(size)).rounded(.up))))
        }

        /// The value as a row draws it: the new value, then what it was.
        static func valueText(_ change: PostCall.Change, shown: String) -> String {
            change.before(shown).map { "\(shown)  was \($0)" } ?? shown
        }

        static func rowHeight(_ change: PostCall.Change, shown: String) -> CGFloat {
            let count = lines(valueText(change, shown: shown), size: valueSize, width: valueWidth, limit: 2)
            return CGFloat(count) * lineHeight(valueSize) + rowPadding
        }

        static let groups: [(object: String, title: String)] = [
            ("contact", "Contact"), ("company", "Company"), ("deal", "Deal"), ("other", "Other"),
        ]
        static let typeRow: CGFloat = 26
    }

    @Published var mode: Mode = .idle
    /// The dashboard has someone signed in to record for.
    @Published var recorderReady = false
    /// The call's side stopped reaching Vocify and restarting didn't bring it back.
    @Published var callAudioLost = false
    @Published var postCall: PostCall?
    /// The changes the rep keeps ticked; starts as everything not flagged "check".
    @Published var keptChanges: Set<String> = []
    /// Options the rep picked in the card, by change key.
    @Published var editedValues: [String: String] = [:]
    @Published var postCallTab: PostCallTab = .crm
    /// The change whose options are open under it.
    @Published var openOptions: String?
    /// Lets the controller move the island when the memo's state changes.
    var onPostCallChange: (() -> Void)?
    /// Lets the controller react when the call's audio is lost or comes back (was, now).
    var onCallAudioChange: ((Bool, Bool) -> Void)?
    /// Who the detected call is with, when the tab on screen is a CRM contact.
    @Published var callContact: String?
    /// A dropdown that folds itself away; the line under it shows the time left.
    @Published var countdown: Countdown?
    @Published var geometry = IslandGeometry.measure(IslandGeometry.screen())
    @Published var expanded = false
    /// The pointer is over the closed island: it brightens a little.
    @Published var hovered = false
    @Published var clock: Clock?
    @Published var paused = false
    @Published var turns: [Turn] = []
    /// The call type picker while recording; nil until the dashboard knows the company's types.
    @Published var liveType: LiveType?
    /// Live help for this call, as the dashboard says (nil: an older dashboard without the switch).
    @Published var liveHelp: Bool?
    /// The after-call card's type list is open.
    @Published var postTypeMenuOpen = false
    /// The Mac records and transcribes the call itself: the dashboard's copy of the transcript is ignored.
    var nativeTranscript = false
    @Published var assist: Assist?
    /// The last answer after it retires, so help fades to "Earlier" instead of vanishing.
    @Published var lastHelp: Assist?
    /// Read by the meters on their own timeline; publishing at audio rate would redraw the transcript.
    let levels = LevelStore()

    func size(for mode: Mode, open: Bool) -> CGSize {
        geometry.size(mode, open: open, postCallBody: postCallBodyHeight)
    }

    /// The tabs the card has for this call; one tab draws no tab bar.
    var postCallTabs: [PostCallTab] {
        guard let postCall else { return [.crm] }
        var tabs: [PostCallTab] = [.crm]
        if postCall.email != nil { tabs.append(.email) }
        if postCall.notes || postCall.summary != nil { tabs.append(.notes) }
        return tabs
    }

    var activeTab: PostCallTab { postCallTabs.contains(postCallTab) ? postCallTab : .crm }

    /// The changes the card lists, by record. One the call wasn't clear on is left to the
    /// review in Vocify: it isn't shown here, so it isn't written from here either.
    var groupedChanges: [(title: String, changes: [PostCall.Change])] {
        let sure = postCall?.changes.filter { !$0.check } ?? []
        return PostCallLayout.groups.compactMap { group in
            let changes = sure.filter { $0.object == group.object || (group.object == "other" && !["contact", "company", "deal"].contains($0.object)) }
            return changes.isEmpty ? nil : (group.title, changes)
        }
    }

    func shown(_ change: PostCall.Change) -> String { change.shown(editedValues[change.key]) }

    func rowHeight(_ change: PostCall.Change) -> CGFloat {
        PostCallLayout.rowHeight(change, shown: shown(change))
    }

    /// The whole list's height; the card shows up to `listMax` of it and scrolls the rest.
    var changesHeight: CGFloat {
        groupedChanges.reduce(0) { height, group in
            height + PostCallLayout.groupLabel + group.changes.reduce(0) { $0 + rowHeight($1) }
        }
    }

    var listHeight: CGFloat { min(changesHeight, PostCallLayout.listMax) }

    /// Ready, but every change needs a look: the card sends the rep to the review instead.
    var nothingSure: Bool { groupedChanges.isEmpty }

    /// The card's height from what it shows, using the same sizes the view draws.
    private var postCallBodyHeight: CGFloat {
        typealias L = PostCallLayout
        guard let postCall else { return L.top + L.header + L.line + L.bottom }
        var height = L.top + L.header
        if postTypeMenuOpen, let type = postCall.type { height += CGFloat(type.options.count + 1) * L.typeRow + 6 }
        if postCallTabs.count > 1 { height += L.gap + L.tabs + L.gap }
        switch activeTab {
        case .crm:
            switch postCall.stage {
            case .writing, .done, .internal:
                height += L.line
            case .applying:
                height += L.line + 6
            case .review:
                height += L.line
            case .ready:
                height += nothingSure ? L.line : listHeight + L.actions
            }
            if postCall.meeting != nil, postCall.stage != .internal { height += L.meeting }
        case .email:
            height += emailHeight(postCall)
        case .notes:
            height += notesHeight(postCall)
        }
        return height + L.bottom
    }

    /// The draft's box: who it's for, the subject and its first lines.
    func emailBoxHeight(_ email: PostCall.Email) -> CGFloat {
        typealias L = PostCallLayout
        let body = email.preview.map { CGFloat(L.lines($0, size: 12, width: L.width - L.inset * 2 - 24, limit: L.emailLines)) * L.lineHeight(12) } ?? 0
        return 20 + (email.to != nil ? L.lineHeight(11) : 0) + L.lineHeight(12.5) + (email.preview != nil ? 4 + body : 0)
    }

    private func emailHeight(_ postCall: PostCall) -> CGFloat {
        typealias L = PostCallLayout
        var height: CGFloat = 0
        if let email = postCall.email {
            if email.state == .ready, email.subject != nil || email.preview != nil {
                height += L.gap + emailBoxHeight(email) + L.actions
            } else {
                height += L.line
            }
        }
        return height
    }

    func summaryHeight(_ summary: String) -> CGFloat {
        typealias L = PostCallLayout
        return CGFloat(L.lines(summary, size: 12, width: L.width - L.inset * 2, limit: L.noteLines)) * L.lineHeight(12)
    }

    private func notesHeight(_ postCall: PostCall) -> CGFloat {
        typealias L = PostCallLayout
        return (postCall.summary.map { L.gap + summaryHeight($0) } ?? 0) + L.actions
    }

    /// Applies one `shell:state` update; keys that are absent keep their value.
    func apply(_ state: [String: Any]) {
        if let paused = state["paused"] as? Bool, paused != self.paused { self.paused = paused }
        if let ready = state["recorderReady"] as? Bool, ready != recorderReady { recorderReady = ready }
        if let lost = state["callAudioLost"] as? Bool, lost != callAudioLost {
            let was = callAudioLost
            callAudioLost = lost
            onCallAudioChange?(was, lost)
        }
        if state.keys.contains("postCall") {
            let next = (state["postCall"] as? [String: Any]).flatMap(PostCall.init)
            if let next, next.memoId != postCall?.memoId || (postCall?.changes.isEmpty == true && !next.changes.isEmpty) {
                keptChanges = Set(next.changes.filter { !$0.check }.map(\.key))
                editedValues = [:]
                openOptions = nil
                if next.memoId != postCall?.memoId { postCallTab = .crm }
                postTypeMenuOpen = false
            }
            if next != postCall {
                postCall = next
                onPostCallChange?()
            }
        }
        if let on = state["liveHelp"] as? Bool, on != liveHelp { liveHelp = on }
        if state.keys.contains("liveType") {
            let next = (state["liveType"] as? [String: Any]).flatMap(LiveType.init)
            if next != liveType { liveType = next }
        }
        if state.keys.contains("callContact") {
            let name = ((state["callContact"] as? [String: Any])?["name"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let next = name?.isEmpty == false ? name : nil
            if next != callContact { callContact = next }
        }
        if let raw = state["clock"] as? [String: Any], let started = raw["startedAt"] as? Double {
            let next = Clock(
                startedAt: Date(timeIntervalSince1970: started / 1000),
                paused: (raw["pausedMs"] as? Double ?? 0) / 1000,
                pausedAt: (raw["pausedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
            )
            if next != clock { clock = next }
        }
        if let raw = state["levels"] as? [String: Any] {
            levels.update(you: raw["you"] as? Double ?? 0, them: raw["them"] as? Double ?? 0)
        }
        if state.keys.contains("assist") {
            let raw = state["assist"] as? [String: Any]
            let next = raw.flatMap { raw -> Assist? in
                let drafting = (raw["stage"] as? String) == "draft"
                let say = raw["sayThis"] as? String ?? ""
                let bridge = raw["bridge"] as? String ?? ""
                // A draft is the loading state (the label only); an answer needs its line.
                guard drafting || !say.isEmpty else { return nil }
                return Assist(
                    label: raw["label"] as? String ?? "",
                    isQuestion: (raw["kind"] as? String) == "question",
                    drafting: drafting,
                    bridge: bridge,
                    sayThis: say,
                    thenAsk: raw["thenAsk"] as? String ?? ""
                )
            }
            if next != assist {
                if DesktopBridge.helpLogOn {
                    let what = next.map { "\($0.drafting ? "draft" : "answer") \($0.label): \($0.drafting ? $0.bridge : $0.sayThis)" } ?? "cleared"
                    DesktopBridge.helpLog.info("island \(what, privacy: .public)")
                }
                if let current = assist, !current.drafting, next == nil { lastHelp = current }
                assist = next
            }
        }
        if !nativeTranscript, let overlay = state["overlay"] as? [String: Any] {
            let next = (overlay["turns"] as? [[String: Any]] ?? []).enumerated().map { index, raw in
                Turn(
                    id: raw["key"] as? String ?? "row-\(index)",
                    you: raw["you"] as? Bool ?? false,
                    label: raw["label"] as? String,
                    text: raw["text"] as? String ?? "",
                    pending: raw["pending"] as? String ?? ""
                )
            }
            if next != turns { turns = next }
        }
    }
}

extension MeetingPillState {
    /// The native recorder's transcript, straight to the bubbles.
    func showLive(_ rows: [LiveTranscript.Row]) {
        let next = rows.map { Turn(id: $0.key, you: $0.you, label: $0.label, text: $0.text, pending: $0.pending) }
        if next != turns { turns = next }
    }
}

/// Latest loudness per side. A side that stops sending (silence) fades out on its own.
final class LevelStore {
    private var you: (value: Double, at: Date) = (0, .distantPast)
    private var them: (value: Double, at: Date) = (0, .distantPast)
    private static let fade: TimeInterval = 0.5

    func update(you: Double, them: Double) {
        let now = Date()
        if you != self.you.value { self.you = (you, now) }
        if them != self.them.value { self.them = (them, now) }
    }

    func value(you side: Bool, at now: Date) -> Double {
        let level = side ? you : them
        return level.value * max(0, 1 - now.timeIntervalSince(level.at) / Self.fade)
    }

    /// Whose voice the wave shows now; it holds its colour through silence and near ties.
    private var shownSide: WaveSide = .them

    func side(at now: Date) -> WaveSide {
        shownSide = WaveSide.next(you: value(you: true, at: now), them: value(you: false, at: now), previous: shownSide)
        return shownSide
    }
}

/// Where the island sits: around the camera housing, or under the menu bar on screens without one.
struct IslandGeometry: Equatable {
    static let ear: CGFloat = 82
    /// Just room for the mark, so the idle island barely widens the camera housing.
    static let idleEar: CGFloat = 36

    var notchWidth: CGFloat
    var barHeight: CGFloat
    var screenHeight: CGFloat

    private var gap: CGFloat { max(notchWidth, 12) }

    /// Room for an app icon or a small record dot, no more.
    static let callEar: CGFloat = 46

    func earWidth(_ mode: MeetingPillState.Mode, open: Bool) -> CGFloat {
        guard !open else { return Self.ear }
        switch mode {
        case .idle: return Self.idleEar
        case .call, .postCall: return Self.callEar
        default: return Self.ear
        }
    }

    func size(_ mode: MeetingPillState.Mode, open: Bool, postCallBody: CGFloat = 44) -> CGSize {
        let closed = CGSize(width: gap + earWidth(mode, open: false) * 2, height: barHeight)
        switch mode {
        case .idle:
            return open ? CGSize(width: max(gap + Self.ear * 2, 380), height: barHeight + 56) : closed
        case .recording:
            return open ? CGSize(width: max(gap + Self.ear * 2, 460), height: min(400, (screenHeight * 0.5).rounded())) : closed
        case .call:
            return open ? CGSize(width: max(gap + Self.ear * 2, 380), height: barHeight + 56) : closed
        case .postCall:
            return open ? CGSize(width: max(gap + Self.ear * 2, MeetingPillState.PostCallLayout.width), height: barHeight + postCallBody) : closed
        case .stopped:
            return open ? CGSize(width: max(gap + Self.ear * 2, 380), height: barHeight + 56) : closed
        case .starting:
            return closed
        }
    }

    /// The built-in display when it has a notch, otherwise the screen with the menu bar.
    static func screen() -> NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
    }

    static func measure(_ screen: NSScreen?) -> IslandGeometry {
        guard let screen else { return IslandGeometry(notchWidth: 0, barHeight: 30, screenHeight: 800) }
        let menuBar = screen.frame.maxY - screen.visibleFrame.maxY
        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea,
           let right = screen.auxiliaryTopRightArea {
            return IslandGeometry(
                notchWidth: screen.frame.width - left.width - right.width,
                barHeight: screen.safeAreaInsets.top,
                screenHeight: screen.frame.height
            )
        }
        return IslandGeometry(notchWidth: 0, barHeight: max(menuBar, 30), screenHeight: screen.frame.height)
    }
}

/// Clickable on the first click without activating Vocify, so the call keeps focus.
private final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// The island never takes focus from the call, so its first click must act, not just activate it.
private final class IslandHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class MeetingPillController {
    static let shared = MeetingPillController()

    let state = MeetingPillState()
    private var panel: NSPanel?
    private weak var bridge: DesktopBridge?
    private let calls = MicActivityMonitor()
    /// Set by a recording or a dismiss; cleared once the mic goes quiet, i.e. the call ended.
    private var callHandled = false
    private var startTimeout: Task<Void, Never>?
    private var autoClose: Task<Void, Never>?
    private var lastPostCallStage: MeetingPillState.PostCall.Stage?
    private var hangUp: Task<Void, Never>?
    /// The call app being recorded; its letting go of the mic is the hang-up.
    private var recordingCaller: MicActivityMonitor.Caller?
    /// The call app holding the mic right now, as last reported.
    private var currentCaller: MicActivityMonitor.Caller?
    /// The app the call being recorded happens in (what the rep pressed Record on, else what holds the mic).
    var callAppBundleID: String? { recordingCaller?.bundleID ?? currentCaller?.bundleID }
    /// Dialers grab the mic again for a moment after a call (tones, readiness); that is not a
    /// new call. The app just recorded is not offered again until this passes.
    private var quiet: (bundleID: String, until: Date)?
    private static let afterCallQuiet: TimeInterval = 120
    private static let idleLinger: TimeInterval = 5
    private static let callLinger: TimeInterval = 8
    private static let postCallLinger: TimeInterval = 14
    private static let doneLinger: TimeInterval = 3
    /// A call app can drop the mic for a moment (device switch); a hang-up lasts.
    private static let hangUpGrace: TimeInterval = 3
    private var screenObserver: NSObjectProtocol?

    /// Offers to record when a call starts. Called once the dashboard can receive commands.
    func watchCalls(bridge: DesktopBridge) {
        self.bridge = bridge
        calls.onCall = { [weak self] caller in self?.callChanged(caller) }
        calls.start()
        state.onPostCallChange = { [weak self] in self?.postCallChanged() }
        state.onCallAudioChange = { [weak self] was, now in self?.callAudioChanged(was: was, now: now) }
        RecordShortcut.shared.onPress = { [weak self] in self?.shortcutPressed() }
        RecordShortcut.shared.activate()
        transition(to: .idle, expanded: false)
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let controller = self else { return }
            MainActor.assumeIsolated { controller.remeasure() }
        }
    }

    func show(bridge: DesktopBridge) {
        self.bridge = bridge
        callHandled = true
        startTimeout?.cancel()
        if case .call(let caller) = state.mode {
            recordingCaller = caller
        } else if state.mode != .recording {
            recordingCaller = currentCaller
        }
        calls.ignoresWebKit = true
        transition(to: .recording, expanded: state.mode == .recording && state.expanded)
    }

    /// Back to rest: the last call's update if one is pending, else the mark beside the camera.
    func hide() {
        startTimeout?.cancel()
        hangUp?.cancel()
        if state.mode == .recording || state.mode.isStopped, let bundleID = recordingCaller?.bundleID {
            quiet = (bundleID, Date().addingTimeInterval(Self.afterCallQuiet))
        }
        recordingCaller = nil
        calls.ignoresWebKit = false
        state.callContact = nil
        rest()
    }

    private func rest() {
        if let postCall = state.postCall {
            lastPostCallStage = postCall.stage
            let open = postCall.stage != .writing
            transition(to: .postCall, expanded: open)
            if open, postCall.stage != .applying {
                startCountdown(postCall.stage == .done && postCall.pending == 0 ? Self.doneLinger : Self.postCallLinger)
            }
        } else {
            transition(to: .idle, expanded: false)
        }
    }

    /// Rows came or went in the open card: the window follows at once, the countdown keeps running.
    private func fitPostCall() {
        guard let panel, state.mode == .postCall else { return }
        panel.setFrame(frame(for: state.size(for: .postCall, open: state.expanded)), display: true)
        panel.invalidateShadow()
    }

    func toggle() {
        switch state.mode {
        case .recording:
            transition(to: .recording, expanded: !state.expanded)
        case .idle, .call:
            transition(to: state.mode, expanded: !state.expanded)
            if state.expanded { startCountdown(state.mode == .idle ? Self.idleLinger : Self.callLinger) }
        case .postCall:
            transition(to: .postCall, expanded: !state.expanded)
            if state.expanded { startCountdown(Self.postCallLinger) }
        case .starting, .stopped:
            break
        }
    }

    func collapse() {
        if state.expanded { transition(to: state.mode, expanded: false) }
    }

    /// The pointer holds a self-closing dropdown open; leaving lets the line run out again.
    func pointer(inside: Bool) {
        hover(inside)
        // The stop grace always runs out: a pointer resting where Stop was clicked must not hold the memo back.
        guard var countdown = state.countdown, state.expanded, !state.mode.isStopped else { return }
        let now = Date()
        if inside, let since = countdown.runningSince {
            countdown.remaining -= now.timeIntervalSince(since)
            countdown.runningSince = nil
            autoClose?.cancel()
        } else if !inside, countdown.runningSince == nil {
            // Never snaps shut the moment the pointer leaves.
            countdown.remaining = max(countdown.remaining, 1.5)
            countdown.runningSince = now
            scheduleAutoClose(after: countdown.remaining)
        }
        state.countdown = countdown
    }

    /// Under the pointer the closed island brightens a little. Its size never changes, so
    /// nothing moves and the window is never resized while the pointer is on it.
    private func hover(_ inside: Bool) {
        guard inside != state.hovered else { return }
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { state.hovered = inside }
    }

    private func startCountdown(_ total: TimeInterval) {
        state.countdown = .init(total: total, remaining: total, runningSince: Date())
        scheduleAutoClose(after: total)
    }

    private func scheduleAutoClose(after delay: TimeInterval) {
        autoClose?.cancel()
        autoClose = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, !Task.isCancelled, self.state.countdown != nil else { return }
            if case .stopped(let grace) = self.state.mode {
                self.run(grace.onFinish)
            } else if self.state.mode == .postCall, let postCall = self.state.postCall, postCall.stage == .done, postCall.pending == 0 {
                self.dismissPostCall()
            } else {
                self.collapse()
            }
        }
    }

    /// Pauses, says so with Resume, and ends once the grace runs out (see StopGrace).
    func stop(byHangUp: Bool = false) {
        guard state.mode == .recording else { return }
        hangUp?.cancel()
        let grace = StopGrace(byHangUp: byHangUp, wasPaused: state.paused)
        if grace.immediate {
            run(grace.onFinish)
            return
        }
        run(grace.onStop)
        transition(to: .stopped(grace), expanded: true)
        startCountdown(StopGrace.seconds)
    }

    /// Carries on recording the same call, as if Stop never happened.
    func resumeRecording() {
        guard case .stopped(let grace) = state.mode else { return }
        run(grace.onResume)
        transition(to: .recording, expanded: false)
    }

    /// Ending the recording hands it to the dashboard; the memo is written in the background
    /// and the island shows its update when it's ready.
    private func run(_ steps: [StopGrace.Step]) {
        for step in steps {
            switch step {
            case .pause: bridge?.emitCommand("pause")
            case .resume: bridge?.emitCommand("resume")
            case .callEnded: bridge?.emitCallEnded()
            case .stop:
                hide()
                bridge?.emitCommand("stop")
            }
        }
    }

    private func callAudioChanged(was: Bool, now: Bool) {
        if LostAudio.opensIsland(was: was, now: now, recording: state.mode == .recording, open: state.expanded) {
            transition(to: .recording, expanded: true)
        }
    }

    /// The record shortcut: the same as pressing Record, or Stop while recording.
    func shortcutPressed() {
        switch state.mode {
        case .recording:
            stop()
        case .stopped:
            resumeRecording()
        case .starting:
            return
        case .postCall:
            // A new call: the last one's card stays in Vocify.
            transition(to: .idle, expanded: false)
            record()
        default:
            record()
        }
    }

    func openApp() {
        bridge?.showMainWindow()
    }

    func togglePause() {
        bridge?.emitCommand(state.paused ? "resume" : "pause")
    }

    /// Starts in the background so the call keeps focus; errors bring Vocify forward.
    /// Signed out, it opens Vocify to sign in instead of waiting on a recorder that isn't there.
    func record() {
        let previous = state.mode
        guard previous == .idle || { if case .call = previous { return true } else { return false } }() else { return }
        guard state.recorderReady else {
            openApp()
            return
        }
        if case .call(let caller) = previous {
            recordingCaller = caller
        } else {
            lookUpCallSource()
        }
        calls.ignoresWebKit = true
        transition(to: .starting, expanded: false)
        bridge?.emitCommand("listen")
        startTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard let self, !Task.isCancelled, self.state.mode == .starting else { return }
            self.calls.ignoresWebKit = false
            self.transition(to: previous, expanded: false)
            self.bridge?.showMainWindow()
        }
    }

    func dismissCall() {
        callHandled = true
        hide()
    }

    private func postCallAction(_ type: String, _ details: [String: Any] = [:]) {
        var action = details
        action["type"] = type
        bridge?.emitPostCallAction(action)
    }

    /// Writes the ticked changes; the dashboard holds the write for the undo window first.
    func approvePostCall() {
        guard let postCall = state.postCall else { return }
        let omit = postCall.changes.map(\.key).filter { !state.keptChanges.contains($0) }
        guard omit.count < postCall.changes.count else { return }
        let edits = state.editedValues.filter { key, value in
            postCall.changes.contains { $0.key == key && $0.value != value }
        }
        postCallAction("approve", ["omit": omit, "edits": edits])
    }

    func undoPostCall() { postCallAction("undo") }

    /// The memo's page in Vocify, for anything the island doesn't cover.
    func reviewPostCall() {
        postCallAction("review")
        bridge?.showMainWindow()
    }

    func openEmail() {
        postCallAction("openEmail")
        bridge?.showMainWindow()
    }

    func skipEmail() { postCallAction("skipEmail") }
    func unskipEmail() { postCallAction("unskipEmail") }
    /// After the call: score it as another type.
    func setCallType(_ key: String) {
        state.postTypeMenuOpen = false
        fitPostCall()
        if key != state.postCall?.type?.key { postCallAction("setType", ["key": key]) }
    }

    func togglePostTypeMenu() {
        state.postTypeMenuOpen.toggle()
        fitPostCall()
    }

    /// The type the rep chose while recording; nil hands it back to Vocify's proposal.
    func pickCallType(_ key: String?) {
        if let key, let current = state.liveType {
            state.liveType = MeetingPillState.LiveType(selected: key, proposed: false, options: current.options)
        }
        bridge?.emitCallType(key)
    }

    /// Live help on or off for this call only.
    func toggleLiveHelp() {
        bridge?.emitCommand(LiveHelpSwitch.command(turningOn: state.liveHelp == false))
    }
    func addMeeting() { postCallAction("addMeeting") }

    func openNotes() {
        postCallAction("notes")
        bridge?.showMainWindow()
    }

    /// Done with this call's card; anything left stays in Vocify.
    func dismissPostCall() { postCallAction("dismiss") }

    func toggleChange(_ key: String) {
        if state.keptChanges.contains(key) {
            state.keptChanges.remove(key)
        } else {
            state.keptChanges.insert(key)
        }
    }

    /// An option picked in a change's menu: a checkbox list adds or removes it, a list of one
    /// replaces the value. Picking keeps the change ticked.
    func pick(_ option: String, for change: MeetingPillState.PostCall.Change) {
        var next = option
        if change.multiple {
            var values = change.values(state.editedValues[change.key])
            if let index = values.firstIndex(of: option) { values.remove(at: index) } else { values.append(option) }
            next = values.joined(separator: ";")
        }
        state.editedValues[change.key] = next == change.value ? nil : next
        state.keptChanges.insert(change.key)
        // A list of one is answered by the pick; a checkbox list stays open for more.
        if !change.multiple { closeOptions() }
        fitPostCall()
    }

    func showTab(_ tab: MeetingPillState.PostCallTab) {
        guard state.postCallTab != tab else { return }
        closeOptions()
        state.postCallTab = tab
        fitPostCall()
    }

    // MARK: Options

    private var optionsPanel: NSPanel?
    private var optionsMonitors: [Any] = []

    /// A change's options float under its value, over the card, like any dropdown.
    /// `anchor` is the value's frame in the island (top-left origin).
    func toggleOptions(_ change: MeetingPillState.PostCall.Change, anchor: CGRect) {
        let reopening = state.openOptions == change.key
        closeOptions()
        guard !reopening, let panel, let content = panel.contentView else { return }
        typealias L = MeetingPillState.PostCallLayout
        let size = L.optionsSize(change)
        // The options' text lines up with the value's.
        let below = panel.convertPoint(toScreen: NSPoint(x: anchor.minX - L.optionsPadding - 8, y: content.bounds.height - anchor.maxY - 4))
        var frame = NSRect(x: below.x, y: below.y - size.height, width: size.width, height: size.height)
        if let screen = panel.screen, frame.minY < screen.visibleFrame.minY {
            frame.origin.y = below.y + anchor.height + 8
        }
        let popup = optionsPanel ?? makeOptionsPanel()
        let host = IslandHostingView(rootView: OptionPopup(state: state, change: change) { [weak self] value in
            self?.pick(value, for: change)
        })
        host.sizingOptions = []
        popup.contentView = host
        popup.setFrame(frame, display: true)
        popup.orderFrontRegardless()
        state.openOptions = change.key
        watchOptions()
    }

    func closeOptions() {
        optionsMonitors.forEach(NSEvent.removeMonitor)
        optionsMonitors = []
        optionsPanel?.orderOut(nil)
        if state.openOptions != nil { state.openOptions = nil }
    }

    /// A click anywhere but the options (or a scroll) closes them, as a menu does.
    private func watchOptions() {
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp, .rightMouseDown, .scrollWheel], handler: { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, event.window !== self.optionsPanel else { return }
                if event.type != .leftMouseUp {
                    self.closeOptions()
                    return
                }
                // Decided once the click is done: a click on a value has already opened or closed
                // its own options by then; any other click leaves them as they were, so they close.
                let open = self.state.openOptions
                DispatchQueue.main.async {
                    if open != nil, self.state.openOptions == open { self.closeOptions() }
                }
            }
            return event
        }) {
            optionsMonitors.append(local)
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.closeOptions() }
        }) {
            optionsMonitors.append(global)
        }
    }

    private func makeOptionsPanel() -> NSPanel {
        let popup = IslandPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        popup.isFloatingPanel = true
        // Above the island, which sits at the status bar's level.
        popup.level = .popUpMenu
        popup.isOpaque = false
        popup.backgroundColor = .clear
        popup.hasShadow = true
        popup.hidesOnDeactivate = false
        popup.isMovable = false
        popup.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        popup.appearance = NSAppearance(named: .darkAqua)
        optionsPanel = popup
        return popup
    }

    /// The dashboard moved the call on (written, ready, email drafted...).
    private func postCallChanged() {
        // A new call, or this one moved past its changes: its options no longer apply.
        if state.openOptions == nil || state.postCall?.stage != .ready { closeOptions() }
        switch state.mode {
        case .recording, .starting, .call, .stopped:
            return  // shown once the island is back at rest
        case .idle:
            if state.postCall != nil { rest() }
        case .postCall:
            guard let postCall = state.postCall else {
                lastPostCallStage = nil
                transition(to: .idle, expanded: false)
                return
            }
            let previous = lastPostCallStage
            lastPostCallStage = postCall.stage
            guard previous != postCall.stage else {
                fitPostCall()  // a row arrived (email, meeting): grow in place, closed island just counts it
                return
            }
            switch postCall.stage {
            case .writing:
                // Nothing to decide yet: the closed island's spinner says enough.
                if state.expanded { transition(to: .postCall, expanded: false) } else { fitPostCall() }
            case .applying:
                autoClose?.cancel()
                state.countdown = nil
                fitPostCall()
            case .ready, .review, .done, .internal:
                rest()
            }
        }
    }

    private func callChanged(_ caller: MicActivityMonitor.Caller?) {
        currentCaller = caller
        if caller == nil {
            callHandled = false
            if state.mode != .recording, state.mode != .starting, !state.mode.isStopped { bridge?.emitCallEnded() }
        }
        switch state.mode {
        case .recording:
            watchForHangUp(caller)
            return
        case .starting, .stopped:
            return
        case .idle, .call, .postCall:
            if let caller, !callHandled, bridge?.isListening != true, !isQuiet(caller) {
                guard state.mode != .call(caller) else { return }
                state.callContact = nil
                // Drops down once to be noticed, then settles beside the camera.
                transition(to: .call(caller), expanded: true)
                startCountdown(Self.callLinger)
                lookUpCallContact()
            } else if case .call = state.mode {
                hide()
            }
        }
    }

    private func isQuiet(_ caller: MicActivityMonitor.Caller) -> Bool {
        guard let quiet, Date() < quiet.until else { return false }
        return caller.bundleID == quiet.bundleID
    }

    /// Recording a detected call: the call app letting go of the mic ends the recording too.
    /// Safari's calls can't be told apart from Vocify's own capture, so they end on Stop.
    private func watchForHangUp(_ caller: MicActivityMonitor.Caller?) {
        guard let recorded = recordingCaller, recorded.bundleID != nil else { return }
        guard caller == nil else {
            hangUp?.cancel()
            return
        }
        hangUp?.cancel()
        hangUp = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.hangUpGrace * 1_000_000_000))
            guard let self, !Task.isCancelled, self.state.mode == .recording, self.currentCaller == nil else { return }
            self.stop(byHangUp: true)
        }
    }

    /// Reads the CRM page on screen; the dashboard turns it into the contact's name.
    private func lookUpCallContact() {
        let caller = currentCaller
        Task { @MainActor [weak self] in
            let read = await CrmPageReader.read(ask: true)
            guard let self, case .call = self.state.mode else { return }
            self.bridge?.emitCallSource(CallSource.app(bundleID: caller?.bundleID) ?? read.source)
            if let urls = read.result["urls"] as? [String], !urls.isEmpty {
                self.bridge?.emitCallPages(urls)
            }
        }
    }

    /// Recording without a detected call (the shortcut, the idle island): name the app
    /// holding the mic, if any, without asking for browser access.
    private func lookUpCallSource() {
        let caller = currentCaller
        if let native = CallSource.app(bundleID: caller?.bundleID) {
            bridge?.emitCallSource(native)
            return
        }
        guard caller != nil else { return }
        Task { @MainActor [weak self] in
            let read = await CrmPageReader.read(ask: false)
            self?.bridge?.emitCallSource(read.source)
        }
    }

    private func remeasure() {
        state.geometry = IslandGeometry.measure(IslandGeometry.screen())
        guard let panel, panel.isVisible else { return }
        panel.setFrame(frame(for: state.size(for: state.mode, open: state.expanded)), display: true)
    }

    /// Hangs from the top edge, centred on the camera housing.
    private func frame(for size: CGSize) -> NSRect {
        guard let screen = IslandGeometry.screen() else { return NSRect(origin: .zero, size: size) }
        var midX = screen.frame.midX
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            midX = (left.maxX + right.minX) / 2
        }
        return NSRect(x: (midX - size.width / 2).rounded(), y: screen.frame.maxY - size.height, width: size.width, height: size.height)
    }

    /// The window first covers both the old and new shape, the shape animates inside it,
    /// then the window fits the new shape. The frame and SwiftUI never animate against each other.
    private func transition(to mode: MeetingPillState.Mode, expanded: Bool) {
        closeOptions()
        autoClose?.cancel()
        state.countdown = nil
        let panel = ensure()
        let wasVisible = panel.isVisible
        state.geometry = IslandGeometry.measure(IslandGeometry.screen())
        let target = state.size(for: mode, open: expanded)
        let current = wasVisible ? panel.frame.size : target
        let cover = CGSize(width: max(current.width, target.width), height: max(current.height, target.height))
        panel.setFrame(frame(for: cover), display: true)
        panel.hasShadow = expanded
        if !wasVisible { panel.orderFrontRegardless() }

        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let animation: Animation = reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.34, dampingFraction: 0.86)
        withAnimation(wasVisible ? animation : nil) {
            state.mode = mode
            state.expanded = expanded
        } completion: { [weak self] in
            guard let self, self.state.mode == mode, self.state.expanded == expanded else { return }
            // The size now, not at the start: rows can arrive or open while the shape animates.
            panel.setFrame(self.frame(for: self.state.size(for: mode, open: expanded)), display: true)
            panel.invalidateShadow()
        }
    }

    private func ensure() -> NSPanel {
        if let panel { return panel }
        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: state.size(for: .idle, open: false)),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        // Above the menu bar, so the island can sit beside the camera housing.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        // Black like the camera housing it grows out of, in light and dark mode alike.
        panel.appearance = NSAppearance(named: .darkAqua)
        let host = IslandHostingView(rootView: IslandView(state: state, controller: self))
        host.sizingOptions = []
        panel.contentView = host
        self.panel = panel
        return panel
    }
}

private enum IslandStyle {
    static let beige = Color(hue: 35 / 360, saturation: 0.30, brightness: 0.86)
    static let danger = Color(hue: 0, saturation: 0.66, brightness: 0.86)
    static let youBubble = Color(hue: 36 / 360, saturation: 0.30, brightness: 0.34)
    static let themBubble = Color.white.opacity(0.13)
    static let text = Color.white.opacity(0.92)
    static let secondary = Color.white.opacity(0.72)
    /// "check" on a change the call wasn't clear about.
    static let warning = Color(hue: 38 / 360, saturation: 0.62, brightness: 0.95)
    static let collapsedRadius: CGFloat = 12
    static let openRadius: CGFloat = 22
}

struct IslandView: View {
    @ObservedObject var state: MeetingPillState
    let controller: MeetingPillController

    private var open: Bool { state.expanded && state.mode != .starting }
    private var isCall: Bool {
        switch state.mode {
        case .call, .postCall: return true
        default: return false
        }
    }
    private var size: CGSize { state.size(for: state.mode, open: open) }
    private var ear: CGFloat { state.geometry.earWidth(state.mode, open: open) }
    /// Under the pointer (closed only).
    private var lifted: Bool { state.hovered && !open && state.mode != .starting }
    private var radius: CGFloat {
        guard open else { return IslandStyle.collapsedRadius }
        return state.mode == .recording ? IslandStyle.openRadius : 18
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if open {
                switch state.mode {
                case .recording:
                    OpenIsland(state: state, controller: controller)
                        .transition(.opacity)
                case .call(let caller):
                    CallMenu(caller: caller, contact: state.callContact, ready: state.recorderReady, controller: controller)
                        .transition(.opacity)
                case .stopped(let grace):
                    StoppedMenu(title: grace.title, controller: controller)
                        .transition(.opacity)
                case .postCall:
                    if let postCall = state.postCall {
                        PostCallMenu(state: state, postCall: postCall, controller: controller)
                            .transition(.opacity)
                    }
                default:
                    IdleMenu(ready: state.recorderReady, controller: controller)
                        .transition(.opacity)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if open, let countdown = state.countdown {
                CountdownLine(countdown: countdown)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 5)
                    .transition(.opacity)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .top)
        .background(IslandBackground(open: open, barHeight: state.geometry.barHeight))
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous))
        .overlay(GlassRim(radius: radius, barHeight: state.geometry.barHeight).opacity(open ? 1 : lifted ? 0.35 : 0))
        .onHover { inside in controller.pointer(inside: inside) }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }

    /// The strip level with the camera: one ear each side of it, the same when open or closed.
    private var topBar: some View {
        HStack(spacing: 0) {
            leftEar
                .padding(.leading, !open && state.mode != .recording ? 12 : 14)
                .frame(width: ear, alignment: .leading)
            Spacer(minLength: state.geometry.notchWidth)
            rightEar
                .padding(.trailing, !open && isCall ? 10 : 12)
                .frame(width: ear, alignment: .trailing)
        }
        .padding(.horizontal, open ? 6 : 0)
        .frame(height: state.geometry.barHeight)
        .contentShape(Rectangle())
        .onTapGesture { controller.toggle() }
        .help(helpText)
    }

    private var helpText: String {
        switch state.mode {
        case .recording: return open ? "Hide transcript" : "Show transcript"
        case .idle: return open ? "Close" : "Record a meeting"
        case .call: return open ? "Close" : ""
        case .starting, .stopped: return ""
        case .postCall:
            switch state.postCall?.stage {
            case .writing: return "Writing the update"
            case .applying: return "Updating \(state.postCall?.crmName ?? "the CRM")"
            default:
                guard !open else { return "Close" }
                let pending = state.postCall?.pending ?? 0
                return pending == 1 ? "1 thing from your call" : pending > 1 ? "\(pending) things from your call" : ""
            }
        }
    }

    @ViewBuilder private var leftEar: some View {
        switch state.mode {
        case .recording:
            HStack(spacing: 6) {
                RecordingDot(paused: state.paused)
                ElapsedText(clock: state.clock)
            }
        case .call(let caller):
            CallerIcon(caller: caller)
        case .stopped:
            HStack(spacing: 6) {
                RecordingDot(paused: true)
                ElapsedText(clock: state.clock)
            }
        case .starting:
            ProgressView().controlSize(.mini)
        case .idle:
            VocifyMarkIcon()
                .opacity(lifted || open ? 1 : 0.85)
        case .postCall:
            // Closed, the ear carries the status; open, the card does, so it is never shown twice.
            if open {
                VocifyMarkIcon()
            } else {
                switch state.postCall?.stage {
                case .writing, .applying:
                    ProgressView().controlSize(.mini)
                case .done:
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(IslandStyle.beige)
                default:
                    VocifyMarkIcon()
                }
            }
        }
    }

    @ViewBuilder private var rightEar: some View {
        switch state.mode {
        case .recording:
            HStack(spacing: 7) {
                if state.paused {
                    Text("Paused")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(IslandStyle.secondary)
                } else {
                    if state.callAudioLost {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(IslandStyle.warning)
                            .help("Not hearing the call: only your mic is recording")
                            .accessibilityLabel("Can't hear the call")
                    }
                    if state.assist != nil, !open {
                        Image(systemName: "sparkle")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(IslandStyle.beige)
                            .help("Live help is ready")
                            .transition(.opacity)
                    }
                    VoiceWave(levels: state.levels)
                }
                OpenArrow(open: open)
            }
            .animation(.easeOut(duration: 0.4), value: state.assist != nil)
        case .call(let caller):
            if open {
                OpenArrow(open: true)
            } else {
                RecordDot(caller: caller, ready: state.recorderReady, action: controller.record)
            }
        case .stopped:
            EmptyView()
        case .starting:
            Text("Starting")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(IslandStyle.secondary)
        case .idle:
            OpenArrow(open: open)
                .opacity(lifted || open ? 1 : 0.8)
        case .postCall:
            if open {
                OpenArrow(open: true)
            } else if let postCall = state.postCall, postCall.pending > 0 {
                PendingBadge(count: postCall.pending)
            }
        }
    }
}

/// Opened from the mark when nothing is recording: the one thing to do here is record.
private struct IdleMenu: View {
    let ready: Bool
    let controller: MeetingPillController

    var body: some View {
        HStack(spacing: 8) {
            QuietRecordButton(title: "Record meeting", ready: ready, action: controller.record)
            Spacer(minLength: 0)
            IconButton(symbol: "arrow.up.right", help: "Open Vocify", action: controller.openApp)
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
    }
}

/// A call just started: who it is with (the CRM contact on screen) or which app,
/// and one quiet way to record it.
private struct CallMenu: View {
    let caller: MicActivityMonitor.Caller
    let contact: String?
    let ready: Bool
    let controller: MeetingPillController

    var body: some View {
        HStack(spacing: 8) {
            Text(contact ?? caller.name.map { "\($0) call" } ?? "Call in progress")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(contact == nil ? IslandStyle.secondary : IslandStyle.text)
                .lineLimit(1)
            Spacer(minLength: 0)
            QuietRecordButton(title: "Record", ready: ready, action: controller.record)
            IconButton(symbol: "xmark", help: "Skip this call", action: controller.dismissCall)
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
    }
}

/// Just stopped: the memo starts when the line under it runs out; Resume carries on the same recording.
private struct StoppedMenu: View {
    let title: String
    let controller: MeetingPillController

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(IslandStyle.text)
                .lineLimit(1)
            Spacer(minLength: 0)
            PrimaryActionButton(title: "Resume", symbol: "play.fill", help: "Keep recording this call", action: controller.resumeRecording)
        }
        .padding(.horizontal, 14)
        .frame(maxHeight: .infinity)
    }
}

/// Glass like the island, with only a small red dot saying what it does.
/// Signed out, it says so and opens Vocify instead.
private struct QuietRecordButton: View {
    let title: String
    let ready: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if ready {
                    Circle().fill(IslandStyle.danger).frame(width: 7, height: 7)
                }
                Text(ready ? title : "Sign in to record").font(.system(size: 12.5, weight: .medium))
            }
            .foregroundStyle(IslandStyle.text)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Color.white.opacity(hovering ? 0.17 : 0.10), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(ready ? "Records your mic as You and the call as Them" : "Opens Vocify to sign in")
    }
}

/// The record action in the closed call island: a red dot in a faint circle.
private struct RecordDot: View {
    let caller: MicActivityMonitor.Caller
    let ready: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(ready ? IslandStyle.danger : IslandStyle.secondary)
                .frame(width: 7, height: 7)
                .frame(width: 22, height: 22)
                .background(Color.white.opacity(hovering ? 0.2 : 0.11), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(ready ? caller.name.map { "Record this \($0) call" } ?? "Record this call" : "Sign in to record")
        .accessibilityLabel("Record")
    }
}

/// After the call: what goes to the CRM, the email draft and the call's note, one tab each.
/// The CRM tab has one main action; a change the call wasn't clear on is flagged, never hidden.
private struct PostCallMenu: View {
    @ObservedObject var state: MeetingPillState
    let postCall: MeetingPillState.PostCall
    let controller: MeetingPillController
    private typealias L = MeetingPillState.PostCallLayout
    private typealias Change = MeetingPillState.PostCall.Change

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(postCall.contactName ?? "Your call")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(IslandStyle.text)
                    .lineLimit(1)
                if let type = postCall.type {
                    if type.options.isEmpty {
                        TypeTag(label: type.label, open: false).help("What this call was scored as")
                    } else {
                        Button(action: controller.togglePostTypeMenu) {
                            TypeTag(label: type.label, open: true)
                        }
                        .buttonStyle(.plain)
                        .help("What this call was scored as. Change it to score it again.")
                    }
                }
                Spacer(minLength: 0)
                IconButton(symbol: "xmark", help: "Done", action: controller.dismissPostCall)
            }
            .frame(height: L.header)
            if state.postTypeMenuOpen, let type = postCall.type {
                let current = MeetingPillState.PostCall.CallType.Option(key: type.key, label: type.label)
                TypeList(
                    rows: TypeMenu(
                        options: ([current] + type.options).map { TypeMenu.Option(key: $0.key, label: $0.label) },
                        selected: type.key,
                        proposed: false
                    ).rows.filter { $0.key != nil },
                    rowHeight: L.typeRow
                ) { key in
                    if let key { controller.setCallType(key) }
                }
                .padding(.bottom, 6)
            }

            if state.postCallTabs.count > 1 {
                PostCallTabBar(tabs: state.postCallTabs, active: state.activeTab, count: count, choose: controller.showTab)
                    .frame(height: L.tabs)
                    .padding(.vertical, L.gap)
            }

            switch state.activeTab {
            case .crm:
                crm
                if let meeting = postCall.meeting, postCall.stage != .internal { meetingRow(meeting) }
            case .email:
                email
            case .notes:
                notes
            }
        }
        .padding(.horizontal, L.inset)
        .padding(.top, L.top)
        .frame(maxHeight: .infinity, alignment: .top)
        .animation(.easeOut(duration: 0.2), value: postCall)
    }

    private var kept: Int { postCall.changes.filter { state.keptChanges.contains($0.key) }.count }

    /// What each tab still needs from the rep.
    private func count(_ tab: MeetingPillState.PostCallTab) -> Int {
        switch tab {
        case .crm: return postCall.stage == .ready ? kept : postCall.stage == .review ? 1 : 0
        case .email: return postCall.email?.state == .ready ? 1 : 0
        case .notes: return 0
        }
    }

    // MARK: CRM

    @ViewBuilder private var crm: some View {
        switch postCall.stage {
        case .writing:
            line(symbol: nil, busy: true) { Text("Writing the update…").foregroundStyle(IslandStyle.secondary) }
        case .ready where state.nothingSure:
            line(symbol: "exclamationmark.circle", busy: false) {
                Text("Nothing clear enough to write from here").foregroundStyle(IslandStyle.text)
            } trailing: {
                TextAction(title: "Review in Vocify", symbol: "arrow.up.right", action: controller.reviewPostCall)
            }
        case .ready:
            ScrollView(.vertical, showsIndicators: state.changesHeight > L.listMax) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(state.groupedChanges, id: \.title) { group in
                        caption(group.title, color: IslandStyle.secondary)
                            .frame(height: L.groupLabel, alignment: .bottomLeading)
                        ForEach(group.changes) { row($0) }
                    }
                }
            }
            // The window grows into its size while the list is already laid out: start at the top.
            .defaultScrollAnchor(.top)
            .id(postCall.memoId)
            .frame(height: state.listHeight)
            // A list that scrolls fades out at its bottom edge instead of cutting a row.
            .mask {
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .black.opacity(state.changesHeight > state.listHeight ? 0 : 1)], startPoint: .top, endPoint: .bottom)
                        .frame(height: 14)
                }
            }
            HStack(spacing: 8) {
                if postCall.canApprove {
                    PrimaryActionButton(
                        title: kept == 0 ? "Nothing ticked" : "Save \(kept) to \(postCall.crm ?? "the CRM")",
                        symbol: "checkmark",
                        disabled: kept == 0,
                        help: "Writes the ticked changes to \(postCall.crmName)",
                        action: controller.approvePostCall
                    )
                    Spacer(minLength: 0)
                    TextAction(title: "Review in Vocify", symbol: "arrow.up.right", action: controller.reviewPostCall)
                } else {
                    TextAction(title: "Review in Vocify", symbol: "arrow.up.right", action: controller.reviewPostCall)
                    Spacer(minLength: 0)
                }
            }
            .frame(height: L.actions)
        case .applying:
            VStack(spacing: 4) {
                line(symbol: nil, busy: true) {
                    Text("Updating \(postCall.contactName ?? "the contact") in \(postCall.crmName)…").foregroundStyle(IslandStyle.text)
                } trailing: {
                    SmallAction(title: "Undo", action: controller.undoPostCall)
                }
                if let until = postCall.undoUntil { UndoLine(until: until) }
            }
        case .done:
            line(symbol: "checkmark", busy: false) {
                Text(doneText).foregroundStyle(IslandStyle.text)
            }
        case .internal:
            line(symbol: "person.2", busy: false) {
                Text("Internal, nothing goes to the CRM").foregroundStyle(IslandStyle.secondary)
            }
        case .review:
            line(symbol: "exclamationmark.circle", busy: false) {
                Text(postCall.note ?? "Needs a look").foregroundStyle(IslandStyle.text)
            } trailing: {
                TextAction(title: "Review", symbol: "arrow.up.right", action: controller.reviewPostCall)
            }
        }
    }

    private func row(_ change: Change) -> some View {
        let shown = state.shown(change)
        return ChangeRow(
            change: change,
            shown: shown,
            kept: state.keptChanges.contains(change.key),
            height: L.rowHeight(change, shown: shown),
            open: state.openOptions == change.key,
            toggle: { controller.toggleChange(change.key) },
            toggleOptions: { controller.toggleOptions(change, anchor: $0) }
        )
    }

    private func caption(_ title: String, color: Color) -> some View {
        Text(title.uppercased())
            .font(.system(size: 9.5, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(color)
            .padding(.leading, L.rowInset)
            .padding(.bottom, 3)
    }

    private var doneText: String {
        guard let applied = postCall.applied else { return "Updated in \(postCall.crmName)" }
        return applied == 1 ? "1 field updated in \(postCall.crmName)" : "\(applied) fields updated in \(postCall.crmName)"
    }

    /// The agreed meeting: a quiet line under the changes, added with one click.
    @ViewBuilder private func meetingRow(_ meeting: MeetingPillState.PostCall.Meeting) -> some View {
        HStack(spacing: 6) {
            Image(systemName: meeting.state == .added ? "checkmark" : "calendar")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(IslandStyle.secondary)
                .frame(width: L.tick)
            Text(meetingText(meeting))
                .font(.system(size: 11.5))
                .foregroundStyle(IslandStyle.secondary)
                .lineLimit(1)
            Spacer(minLength: 6)
            switch meeting.state {
            case .pending: TextAction(title: "Add", symbol: nil, action: controller.addMeeting)
            case .check: TextAction(title: "Review", symbol: nil, action: controller.reviewPostCall)
            case .added: EmptyView()
            }
        }
        .padding(.horizontal, L.rowInset)
        .frame(height: L.meeting)
    }

    private func meetingText(_ meeting: MeetingPillState.PostCall.Meeting) -> String {
        switch meeting.state {
        case .pending: return meeting.when.map { "Meeting \($0)" } ?? "Meeting agreed"
        case .check: return "Meeting to confirm"
        case .added: return meeting.when.map { "Meeting \($0) added" } ?? "Meeting added"
        }
    }

    // MARK: Email

    @ViewBuilder private var email: some View {
        if let email = postCall.email {
            switch email.state {
            case .ready:
                if email.subject != nil || email.preview != nil {
                    VStack(alignment: .leading, spacing: 0) {
                        if let to = email.to {
                            Text("To \(to)")
                                .font(.system(size: 11))
                                .foregroundStyle(IslandStyle.secondary)
                                .lineLimit(1)
                                .frame(height: L.lineHeight(11), alignment: .leading)
                        }
                        Text(email.subject ?? "Follow-up")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(IslandStyle.text)
                            .lineLimit(1)
                            .frame(height: L.lineHeight(12.5), alignment: .leading)
                        if let preview = email.preview {
                            Text(preview)
                                .font(.system(size: 12))
                                .foregroundStyle(IslandStyle.secondary)
                                .lineLimit(L.emailLines)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .padding(.top, 4)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .frame(height: state.emailBoxHeight(email), alignment: .top)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.top, L.gap)
                    HStack(spacing: 8) {
                        PrimaryActionButton(title: "Open draft", symbol: "arrow.up.right", help: "Opens the email in Vocify to send it", action: controller.openEmail)
                        TextAction(title: "Skip", symbol: nil, action: controller.skipEmail)
                        Spacer(minLength: 0)
                    }
                    .frame(height: L.actions)
                } else {
                    line(symbol: "envelope", busy: false) {
                        Text(email.to.map { "Email to \($0) ready" } ?? "Email ready").foregroundStyle(IslandStyle.text)
                    } trailing: {
                        SmallAction(title: "Open", action: controller.openEmail)
                        SmallAction(title: "Skip", action: controller.skipEmail)
                    }
                }
            case .skipped:
                line(symbol: "envelope", busy: false) {
                    Text("Email skipped").foregroundStyle(IslandStyle.secondary)
                } trailing: {
                    SmallAction(title: "Undo", action: controller.unskipEmail)
                }
            case .sent:
                line(symbol: "checkmark", busy: false) { Text("Email sent").foregroundStyle(IslandStyle.secondary) }
            }
        }
    }

    // MARK: Notes

    @ViewBuilder private var notes: some View {
        if let summary = postCall.summary {
            Text(summary)
                .font(.system(size: 12))
                .foregroundStyle(IslandStyle.text)
                .lineLimit(L.noteLines)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .frame(height: state.summaryHeight(summary), alignment: .top)
                .padding(.top, L.gap)
                .textSelection(.enabled)
        }
        HStack {
            TextAction(title: "Open in Vocify", symbol: "arrow.up.right", action: controller.openNotes)
            Spacer(minLength: 0)
        }
        .frame(height: L.actions)
    }

    /// One row of the card: an icon (or progress), the text, and its actions on the right.
    private func line<Content: View, Trailing: View>(
        symbol: String?,
        busy: Bool,
        @ViewBuilder content: () -> Content,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) -> some View {
        HStack(spacing: 8) {
            Group {
                if busy {
                    ProgressView().controlSize(.mini)
                } else if let symbol {
                    Image(systemName: symbol).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(IslandStyle.beige)
                } else {
                    Color.clear
                }
            }
            .frame(width: 14)
            content()
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 6)
            trailing()
        }
        .frame(height: L.line)
    }
}

/// CRM / Email / Notes, each with what it still needs from the rep.
private struct PostCallTabBar: View {
    let tabs: [MeetingPillState.PostCallTab]
    let active: MeetingPillState.PostCallTab
    let count: (MeetingPillState.PostCallTab) -> Int
    let choose: (MeetingPillState.PostCallTab) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs, id: \.self) { tab in
                PostCallTabButton(tab: tab, active: tab == active, count: count(tab)) { choose(tab) }
            }
        }
        .padding(2)
        .background(Color.white.opacity(0.06), in: Capsule())
    }
}

private struct PostCallTabButton: View {
    let tab: MeetingPillState.PostCallTab
    let active: Bool
    let count: Int
    let action: () -> Void
    @State private var hovering = false

    private var title: String {
        switch tab {
        case .crm: return "CRM"
        case .email: return "Email"
        case .notes: return "Notes"
        }
    }

    private var symbol: String {
        switch tab {
        case .crm: return "person.text.rectangle"
        case .email: return "envelope"
        case .notes: return "doc.text"
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 10.5, weight: .medium))
                Text(title).font(.system(size: 11.5, weight: .medium))
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .semibold).monospacedDigit())
                        .foregroundStyle(active ? Color.black.opacity(0.85) : IslandStyle.text)
                        .frame(minWidth: 16, minHeight: 16)
                        .padding(.horizontal, count > 9 ? 3 : 0)
                        .background(active ? IslandStyle.beige : Color.white.opacity(0.14), in: Capsule())
                }
            }
            .foregroundStyle(active || hovering ? IslandStyle.text : IslandStyle.secondary)
            .frame(maxWidth: .infinity)
            .frame(height: 22)
            .background(Color.white.opacity(active ? 0.14 : hovering ? 0.06 : 0), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(count > 0 ? "\(title), \(count)" : title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// One proposed change: tick to keep, its field, and what it becomes (then what it was).
/// A value with options opens them over the card; free text is edited in Vocify.
private struct ChangeRow: View {
    let change: MeetingPillState.PostCall.Change
    let shown: String
    let kept: Bool
    let height: CGFloat
    let open: Bool
    let toggle: () -> Void
    /// Opens the options under the value, given its frame in the island.
    let toggleOptions: (CGRect) -> Void
    @State private var overValue = false
    @State private var valueFrame: CGRect = .zero
    private typealias L = MeetingPillState.PostCallLayout

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
                Button(action: toggle) {
                    HStack(alignment: .top, spacing: 8) {
                        tick
                        Text(change.label)
                            .font(.system(size: 11.5))
                            .foregroundStyle(IslandStyle.secondary)
                            .lineLimit(1)
                            .frame(width: L.label, height: L.lineHeight(L.valueSize), alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(kept ? "Untick to leave it out" : "Tick to write it")
                .accessibilityLabel(change.label)
                .accessibilityValue(kept ? "Will be written" : "Not written")

                HStack(alignment: .top, spacing: 0) {
                    value
                        .frame(width: L.valueWidth, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(open || overValue ? IslandStyle.text : IslandStyle.secondary)
                        .rotationEffect(.degrees(open ? 180 : 0))
                        .opacity(change.options.isEmpty ? 0 : 1)
                        .frame(width: L.chevron, height: L.lineHeight(L.valueSize))
                }
                .contentShape(Rectangle())
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { valueFrame = $0 }
                .onTapGesture { change.options.isEmpty ? toggle() : toggleOptions(valueFrame) }
                .onHover { overValue = $0 }
                .help(change.options.isEmpty ? "Edit it in Vocify" : change.multiple ? "Pick one or more" : "Pick another value")
                .accessibilityAddTraits(.isButton)
            }
            .padding(.horizontal, L.rowInset)
            .padding(.vertical, L.rowPadding / 2)
            .frame(height: height, alignment: .top)
    }

    private var tick: some View {
        ZStack {
            if kept {
                Circle().fill(IslandStyle.beige)
                Image(systemName: "checkmark")
                    .font(.system(size: 7.5, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.85))
            } else {
                Circle().strokeBorder(change.check ? IslandStyle.warning : IslandStyle.secondary, lineWidth: 1.2)
            }
        }
        .frame(width: L.tick, height: L.tick)
        .padding(.top, (L.lineHeight(L.valueSize) - L.tick) / 2)
    }

    private var value: some View {
        (Text(shown).foregroundColor(kept ? IslandStyle.text : IslandStyle.secondary)
            + Text(change.before(shown).map { "  was \($0)" } ?? "").font(.system(size: 11)).foregroundColor(IslandStyle.secondary))
            .font(.system(size: L.valueSize))
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A change's options in their own small window over the card, in the island's glass.
/// A checkbox list stays open for more ticks; a list of one closes on the pick.
private struct OptionPopup: View {
    @ObservedObject var state: MeetingPillState
    let change: MeetingPillState.PostCall.Change
    let pick: (String) -> Void
    private typealias L = MeetingPillState.PostCallLayout

    var body: some View {
        let selected = change.values(state.editedValues[change.key])
        ScrollView(.vertical, showsIndicators: change.options.count > L.optionsVisible) {
            VStack(spacing: 0) {
                ForEach(change.options) { option in
                    OptionRow(label: option.label, selected: selected.contains(option.value)) { pick(option.value) }
                }
            }
        }
        .padding(L.optionsPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                BehindWindowBlur()
                Color.black.opacity(0.28)
                GlassPanel(radius: 10)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}

private struct OptionRow: View {
    let label: String
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(IslandStyle.beige)
                    .opacity(selected ? 1 : 0)
                    .frame(width: 14)
                Text(label)
                    .font(.system(size: 12))
                    .foregroundStyle(selected || hovering ? IslandStyle.text : IslandStyle.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: MeetingPillState.PostCallLayout.option)
            .background(Color.white.opacity(hovering ? 0.08 : 0), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The island's glass at a smaller scale: a faint fill with a light sheen and the same rim.
private struct GlassPanel: View {
    let radius: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(Color.white.opacity(0.07))
            .overlay(shape.fill(LinearGradient(colors: [Color.white.opacity(0.06), .clear], startPoint: .top, endPoint: .center)))
            .overlay(shape.strokeBorder(
                LinearGradient(
                    colors: [Color.white.opacity(0.30), Color.white.opacity(0.08), Color.white.opacity(0.20)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: 1
            ))
    }
}

/// The card's one main action: a quiet capsule of the island's glass, tinted beige.
private struct PrimaryActionButton: View {
    let title: String
    let symbol: String?
    var disabled = false
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 9, weight: .semibold)) }
                Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1)
            }
            .foregroundStyle(IslandStyle.beige)
            .padding(.horizontal, 11)
            .frame(height: 26)
            .background {
                Capsule()
                    .fill(IslandStyle.beige.opacity(hovering && !disabled ? 0.2 : 0.13))
                    .overlay(Capsule().strokeBorder(IslandStyle.beige.opacity(0.3), lineWidth: 0.5))
            }
        }
        .buttonStyle(PressScale())
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onHover { hovering = $0 }
        .help(help)
    }
}


/// The call-type list, drawn in the island's glass (a macOS menu can't be): one row per type,
/// a tick on the rep's pick, a sparkle on Vocify's proposal.
private struct TypeList: View {
    let rows: [TypeMenu.Row]
    var rowHeight: CGFloat = 26
    let choose: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows, id: \.label) { row in
                TypeListRow(row: row, height: rowHeight) { choose(row.key) }
            }
        }
        .padding(.vertical, 3)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct TypeListRow: View {
    let row: TypeMenu.Row
    let height: CGFloat
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "checkmark")
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(IslandStyle.beige)
                    .opacity(row.checked ? 1 : 0)
                    .frame(width: 12)
                Text(row.label)
                    .font(.system(size: 12))
                    .foregroundStyle(row.key == nil ? IslandStyle.secondary : IslandStyle.text)
                    .lineLimit(1)
                if row.suggested {
                    Image(systemName: "sparkle")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(IslandStyle.beige)
                        .help("Vocify's proposal")
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: height)
            .background(Color.white.opacity(hovering ? 0.08 : 0), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 3)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(row.checked ? .isSelected : [])
    }
}

/// Live help on or off for this call: a small glass switch beside its sparkle.
private struct LiveHelpToggle: View {
    let on: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(on ? IslandStyle.beige : IslandStyle.secondary)
                Capsule()
                    .fill(on ? IslandStyle.beige.opacity(0.85) : Color.white.opacity(hovering ? 0.2 : 0.14))
                    .frame(width: 26, height: 15)
                    .overlay(alignment: on ? .trailing : .leading) {
                        Circle().fill(Color.white).frame(width: 11, height: 11).padding(2)
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: on)
        .help(on ? "Live help is on for this call" : "Live help is off for this call")
        .accessibilityLabel("Live help")
        .accessibilityValue(on ? "On" : "Off")
    }
}

private struct TypeTag: View {
    let label: String
    let open: Bool
    var placeholder = false
    /// Vocify's proposal, not the rep's pick.
    var sparkle = false
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 3) {
            if sparkle {
                Image(systemName: "sparkle").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(IslandStyle.beige)
            }
            Text(label)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 120, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
            if open {
                Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
            }
        }
        .font(.system(size: 11.5))
        .foregroundStyle(hovering && open ? IslandStyle.text : IslandStyle.secondary)
        .opacity(placeholder && !hovering ? 0.8 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }
}

/// The undo window: a hairline that runs out when the write happens.
private struct UndoLine: View {
    let until: Date
    private static let window: TimeInterval = 5

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { context in
            GeometryReader { geo in
                Capsule()
                    .fill(Color.white.opacity(0.32))
                    .frame(width: geo.size.width * max(0, min(1, until.timeIntervalSince(context.date) / Self.window)), height: 2)
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

/// How many things from the call still need the rep, on the closed island.
private struct PendingBadge: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
            .foregroundStyle(Color.black.opacity(0.85))
            .frame(minWidth: 18, minHeight: 18)
            .background(IslandStyle.beige, in: Capsule())
    }
}

/// A row-level action: small glass capsule.
private struct SmallAction: View {
    let title: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(IslandStyle.text)
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(Color.white.opacity(hovering ? 0.17 : 0.09), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
    }
}

/// A footer link: text only, brightens on hover.
private struct TextAction: View {
    let title: String
    let symbol: String?
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .medium)) }
                Text(title).font(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(hovering ? IslandStyle.text : IslandStyle.secondary)
            .padding(.horizontal, 6)
            .frame(height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// How long a dropdown stays: a hairline that shrinks to nothing, then it folds away.
private struct CountdownLine: View {
    let countdown: MeetingPillState.Countdown

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { context in
            GeometryReader { geo in
                Capsule()
                    .fill(Color.white.opacity(0.32))
                    .frame(width: geo.size.width * countdown.fraction(at: context.date), height: 2)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

/// Says the island opens; points up once it has. The whole strip is the button.
private struct OpenArrow: View {
    let open: Bool

    var body: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(IslandStyle.secondary)
            .rotationEffect(.degrees(open ? 180 : 0))
            .accessibilityLabel(open ? "Close" : "Open")
    }
}

private struct VocifyMarkIcon: View {
    var body: some View {
        Group {
            if let mark = VocifyMark.image {
                Image(nsImage: mark).resizable().interpolation(.high)
            } else {
                Image(systemName: "waveform").foregroundStyle(IslandStyle.text)
            }
        }
        .frame(width: 16, height: 16)
        .accessibilityLabel("Vocify")
    }
}

/// Controls, live help and the whole conversation.
private struct OpenIsland: View {
    @ObservedObject var state: MeetingPillState
    let controller: MeetingPillController
    @State private var typeMenuOpen = false
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                CircleButton(
                    symbol: state.paused ? "play.fill" : "pause.fill",
                    help: state.paused ? "Resume recording" : "Pause recording",
                    action: controller.togglePause
                )
                StopButton { controller.stop() }
                if let menu = state.liveType?.menu {
                    Button { typeMenuOpen.toggle() } label: {
                        TypeTag(label: menu.title, open: true, placeholder: menu.placeholder, sparkle: menu.sparkle)
                    }
                    .buttonStyle(.plain)
                    .help(menu.sparkle ? "Vocify's proposal for this call. Change it if it's another kind." : "The call type: live help uses its playbook")
                }
                Spacer(minLength: 0)
                if let on = state.liveHelp {
                    LiveHelpToggle(on: on, action: controller.toggleLiveHelp)
                }
                IconButton(symbol: "arrow.up.right", help: "Open Vocify", action: controller.openApp)
            }
            .padding(.horizontal, 14)
            .frame(height: 38)
            if typeMenuOpen, let menu = state.liveType?.menu {
                TypeList(rows: menu.rows) { key in
                    controller.pickCallType(key)
                    typeMenuOpen = false
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
            }
            if state.callAudioLost, !state.paused {
                CallAudioLostLine()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 2)
            }
            // Live help has its own fixed place above the conversation; only the conversation gives up space.
            // Switched off for this call, the conversation takes its room.
            if state.liveHelp != false {
                HelpSection(current: state.assist, earlier: state.lastHelp)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            Rectangle().fill(Color.white.opacity(0.07)).frame(height: 0.5)
            TranscriptScroll(turns: state.turns)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: state.assist)
    }
}

/// Only the rep's mic is reaching Vocify: said where it's seen, not in a tooltip.
private struct CallAudioLostLine: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(IslandStyle.warning)
            VStack(alignment: .leading, spacing: 1) {
                Text("Not hearing the call")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(IslandStyle.text)
                Text("Only your mic is recording. Check the call's sound plays on this Mac.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(IslandStyle.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct BottomEdgeKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Scrolls freely; follows the newest line only while the reader is at the bottom.
private struct TranscriptScroll: View {
    let turns: [MeetingPillState.Turn]
    @State private var following = true
    private static let bottom = "bottom"
    /// More than one streamed update grows the content, so growth alone never counts as scrolling away.
    private static let followSlack: CGFloat = 120

    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        if turns.isEmpty {
                            Text("Listening…")
                                .font(.system(size: 12.5))
                                .foregroundStyle(IslandStyle.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 28)
                        }
                        LazyVStack(spacing: 5) {
                            ForEach(turns) { turn in
                                TurnBubble(turn: turn).equatable()
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 10)
                        Color.clear
                            .frame(height: 12)
                            .id(Self.bottom)
                            .background(
                                GeometryReader { edge in
                                    Color.clear.preference(key: BottomEdgeKey.self, value: edge.frame(in: .named("transcript")).maxY)
                                }
                            )
                    }
                }
                .coordinateSpace(name: "transcript")
                .defaultScrollAnchor(.bottom)
                .onPreferenceChange(BottomEdgeKey.self) { edge in
                    let next = edge <= viewport.size.height + Self.followSlack
                    if next != following { following = next }
                }
                .onChange(of: turns) {
                    if following { jump(proxy) }
                }
                .onAppear { jump(proxy) }
                .overlay(alignment: .bottom) {
                    if !following {
                        LatestButton { jump(proxy) }
                            .padding(.bottom, 10)
                            .transition(.opacity)
                    }
                }
            }
        }
    }

    private func jump(_ proxy: ScrollViewProxy) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
    }
}

/// One speaker's paragraph. Words still settling are dimmed inline, so the bubble only ever grows.
private struct TurnBubble: View, Equatable {
    let turn: MeetingPillState.Turn

    var body: some View {
        VStack(alignment: turn.you ? .trailing : .leading, spacing: 3) {
            if !turn.you, let label = turn.label {
                Text(label)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(IslandStyle.beige)
                    .padding(.horizontal, 4)
            }
            words
                .font(.system(size: 12.5))
                .lineSpacing(1.5)
                .textSelection(.enabled)
                .padding(.horizontal, 11)
                .padding(.vertical, 7)
                .background(
                    turn.you ? IslandStyle.youBubble : IslandStyle.themBubble,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 340, alignment: turn.you ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: turn.you ? .trailing : .leading)
        .transaction { $0.animation = nil }
    }

    /// Settled words, then the ones still arriving (dimmed), then three dots while the
    /// speaker is still going, so the paragraph visibly keeps growing instead of splitting.
    @ViewBuilder private var words: some View {
        if turn.pending.isEmpty {
            text(dots: nil)
        } else {
            TimelineView(.periodic(from: .now, by: 0.35)) { context in
                text(dots: Int(context.date.timeIntervalSinceReferenceDate / 0.35) % 3)
            }
        }
    }

    private func text(dots phase: Int?) -> Text {
        var out = Text(turn.text).foregroundColor(IslandStyle.text)
        // One or two words are often a false start; the dots alone say someone is speaking.
        let tail = turn.pending.split(separator: " ").count > 2 || !turn.text.isEmpty ? turn.pending : ""
        if !tail.isEmpty {
            let joined = turn.text.isEmpty || tail.first.map { ",.;:!?…)".contains($0) } == true
            out = out + Text((joined ? "" : " ") + tail).foregroundColor(IslandStyle.secondary)
        }
        guard let phase else { return out }
        let lead = turn.text.isEmpty && tail.isEmpty ? "" : " "
        return (0..<3).reduce(out + Text(lead)) { line, dot in
            line + Text("•").foregroundColor(IslandStyle.secondary.opacity(dot == phase ? 1 : 0.35))
        }
    }
}

private struct ElapsedText: View {
    let clock: MeetingPillState.Clock?

    var body: some View {
        Group {
            if let clock, clock.pausedAt == nil {
                TimelineView(.periodic(from: clock.tickOrigin, by: 1)) { context in
                    label(clock.elapsed(at: context.date))
                }
            } else {
                label(clock?.elapsed(at: Date()) ?? 0)
            }
        }
        .font(.system(size: 12.5, weight: .medium).monospacedDigit())
        .foregroundStyle(IslandStyle.text)
        .fixedSize()
    }

    private func label(_ elapsed: TimeInterval) -> Text {
        // A tick can land a hair before the whole second it stands for.
        let total = Int((elapsed + 0.05).rounded(.down))
        let (h, m, s) = (total / 3600, total % 3600 / 60, total % 60)
        return Text(h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s))
    }
}

/// One small voice wave: moves while anyone talks, beige when it's you, white when it's them.
/// Flat and dim in silence, so it never looks like activity that isn't there.
private struct VoiceWave: View {
    let levels: LevelStore
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    private static let rest: [CGFloat] = [3, 4.5, 6, 4.5, 3]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 24, paused: reduceMotion)) { context in
            let you = levels.value(you: true, at: context.date)
            let them = levels.value(you: false, at: context.date)
            let side = levels.side(at: context.date)
            let level = min(1, max(you, them) * 1.4)
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 2) {
                ForEach(0..<5, id: \.self) { index in
                    let wave = reduceMotion ? 1 : 0.55 + 0.45 * sin(t * 9 + Double(index) * 1.2)
                    Capsule()
                        .fill(side == .you ? IslandStyle.beige : Color.white.opacity(0.85))
                        .frame(width: 2.5, height: Self.rest[index] + 10 * level * CGFloat(wave))
                }
            }
            .frame(height: 16)
            // Brightens with the voice instead of switching at a threshold, so it never blinks.
            .opacity(0.45 + 0.55 * min(1, level / 0.15))
        }
        .help("Beige is you speaking, white is them")
        .accessibilityLabel("Voice activity")
    }
}

private struct RecordingDot: View {
    let paused: Bool
    @State private var dim = false
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        Circle()
            .fill(paused ? Color.white.opacity(0.4) : IslandStyle.danger)
            .frame(width: 7, height: 7)
            .opacity(dim && !paused ? 0.35 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = !reduceMotion }
            .accessibilityLabel(paused ? "Paused" : "Recording")
    }
}

private struct CallerIcon: View {
    let caller: MicActivityMonitor.Caller

    var body: some View {
        Group {
            if let id = caller.bundleID, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: url.path))
                    .resizable()
                    .frame(width: 18, height: 18)
            } else {
                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(IslandStyle.text)
            }
        }
        .help(caller.name.map { "\($0) is using the mic" } ?? "A call is using the mic")
    }
}

private struct LatestButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.down").font(.system(size: 9.5, weight: .semibold))
                Text("Latest").font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(IslandStyle.text)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Color(white: 0.2), in: Capsule())
        }
        .buttonStyle(PressScale())
        .help("Jump to the latest line")
    }
}

/// Live help, quiet by design: plain text in a fixed place, no boxes or alerts.
/// A draft offers the bridge line, the answer replaces it in place, and once it
/// retires it stays dimmed as "Earlier" until the next one.
private struct HelpSection: View {
    let current: MeetingPillState.Assist?
    let earlier: MeetingPillState.Assist?

    private var shown: MeetingPillState.Assist? { current ?? earlier }
    private var retired: Bool { current == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(IslandStyle.beige.opacity(retired ? 0.5 : 1))
                Text(heading)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(retired ? IslandStyle.secondary : IslandStyle.beige)
            }
            if let help = shown {
                if help.drafting {
                    // An answer is on its way: the label above says what kind, the words come whole.
                    HStack(spacing: 6) {
                        Text("Preparing a reply")
                            .font(.system(size: 12))
                            .foregroundStyle(IslandStyle.secondary)
                        TypingDots()
                    }
                } else {
                    Text(help.sayThis)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(IslandStyle.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if !help.thenAsk.isEmpty {
                        Text(help.thenAsk)
                            .font(.system(size: 11.5))
                            .foregroundStyle(IslandStyle.secondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                Text("Answers show up here when they ask or push back.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(IslandStyle.secondary.opacity(0.8))
            }
        }
        .opacity(retired && shown != nil ? 0.55 : 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .accessibilityElement(children: .combine)
    }

    private var heading: String {
        guard let shown else { return "Live help" }
        if retired { return "Earlier" }
        return shown.label.isEmpty ? "Live help" : shown.label
    }
}

/// Solid black beside the camera so the island still reads as part of it;
/// below that, dark glass: a blur of what's behind with a light sheen at the top.
private struct IslandBackground: View {
    let open: Bool
    let barHeight: CGFloat

    var body: some View {
        ZStack(alignment: .top) {
            BehindWindowBlur()
            Color.black.opacity(open ? 0.28 : 1)
            LinearGradient(colors: [Color.white.opacity(open ? 0.07 : 0), .clear], startPoint: .top, endPoint: .center)
            // The camera strip melts into the glass instead of ending on a hard line.
            VStack(spacing: 0) {
                Color.black.frame(height: barHeight)
                LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: open ? 16 : 0)
            }
        }
    }
}

/// The glass edge: a thin light rim and a soft inner glow down the sides and round
/// the bottom corners. It fades in below the camera strip, which stays plain black.
private struct GlassRim: View {
    let radius: CGFloat
    let barHeight: CGFloat

    var body: some View {
        let shape = UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius, style: .continuous)
        ZStack {
            shape
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 6)
                .blur(radius: 5)
                .clipShape(shape)
            shape.strokeBorder(
                LinearGradient(
                    colors: [Color.white.opacity(0.34), Color.white.opacity(0.08), Color.white.opacity(0.24)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: 1
            )
        }
        .mask(
            VStack(spacing: 0) {
                Color.clear.frame(height: barHeight)
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 28)
                Color.black
            }
        )
        .allowsHitTesting(false)
    }
}

private struct BehindWindowBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

private struct TypingDots: View {
    private let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Color.white.opacity(0.5))
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * max(0, sin((t * 4) - Double(index) * 0.7)))
                }
            }
        }
        .accessibilityLabel("Writing")
    }
}

private struct StopButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(Color.white)
                    .frame(width: 8, height: 8)
                Text("Stop").font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(IslandStyle.danger.opacity(hovering ? 0.85 : 1), in: Capsule())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help("Stop recording")
        .accessibilityLabel("Stop recording")
    }
}

private struct CircleButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(IslandStyle.text)
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(hovering ? 0.18 : 0.11), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

private struct IconButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hovering ? IslandStyle.text : IslandStyle.secondary)
                .frame(width: 26, height: 26)
                .background(Color.white.opacity(hovering ? 0.1 : 0), in: Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

private struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
