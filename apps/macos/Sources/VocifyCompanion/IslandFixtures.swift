#if DEBUG
import Foundation

/// The island's calling states, for screenshots: `VOCIFY_ISLAND_FIXTURE=<name> Vocify.app/Contents/MacOS/Vocify`.
/// The Electron island has the same names and values (app/island/fixtures/index.mjs), so the two can be
/// compared side by side.
enum IslandFixtures {
    struct Fixture {
        let mode: MeetingPillState.Mode
        let expanded: Bool
        var keypad = false
        let state: [String: Any]
    }

    private static let ana: [String: Any] = [
        "provider": "hubspot", "crmLabel": "HubSpot", "name": "Ana Ruiz",
        "phone": "+34600111222", "callerId": "+34910000000", "state": "callable",
    ]
    private static func onScreen(_ changes: [String: Any]) -> [String: Any] {
        ana.merging(changes) { $1 }
    }
    private static let answeredAt = (Date().timeIntervalSince1970 - 65) * 1000
    private static let inCall: [String: Any] = [
        "onScreen": ana,
        "listening": true,
        "liveHelp": true,
        "dial": ["phase": "active", "name": "Ana Ruiz", "phone": "+34600111222", "answeredAt": answeredAt, "muted": false],
        "clock": ["startedAt": answeredAt, "pausedMs": 0],
        "assist": [
            "stage": "answer", "label": "Price", "kind": "objection",
            "bridge": "Fair question.", "sayThis": "Most teams make it back in the first month of calls.",
        ],
        "overlay": ["turns": [
            ["key": "t1", "you": true, "text": "Hi Ana, it's Dani from Vocify.", "pending": ""],
            ["key": "t2", "you": false, "label": "Ana", "text": "Hi! Yes, I saw your email. How much is it?", "pending": ""],
        ]],
    ]

    static let call: [String: Fixture] = [
        "idle-callable": Fixture(mode: .idle, expanded: false, state: ["onScreen": ana]),
        "idle-open-callable": Fixture(mode: .idle, expanded: true, state: ["onScreen": ana]),
        "idle-open-needs-contact": Fixture(mode: .idle, expanded: true, state: ["onScreen": onScreen(["name": NSNull(), "phone": NSNull(), "state": "needs_contact"])]),
        "idle-no-phone": Fixture(mode: .idle, expanded: false, state: ["onScreen": onScreen(["phone": NSNull(), "state": "no_phone"])]),
        "confirm-callable": Fixture(mode: .dialConfirm, expanded: true, state: ["onScreen": ana]),
        "confirm-no-caller-id": Fixture(mode: .dialConfirm, expanded: true, state: ["onScreen": onScreen(["callerId": NSNull(), "state": "no_caller_id"])]),
        "confirm-needs-contact": Fixture(mode: .dialConfirm, expanded: true, state: ["onScreen": onScreen(["name": NSNull(), "phone": NSNull(), "state": "needs_contact"])]),
        "dialing-ringing": Fixture(mode: .dialing, expanded: true, state: ["dial": ["phase": "ringing", "name": "Ana Ruiz", "phone": "+34600111222", "muted": false]]),
        "in-call": Fixture(mode: .recording, expanded: true, state: inCall),
        "in-call-muted-keypad": Fixture(
            mode: .recording, expanded: true, keypad: true,
            state: inCall.merging(["dial": ["phase": "active", "name": "Ana Ruiz", "phone": "+34600111222", "answeredAt": answeredAt, "muted": true]]) { $1 }
        ),
        "dial-ended-no-answer": Fixture(mode: .dialing, expanded: true, state: ["dial": ["phase": "ended", "name": "Ana Ruiz", "phone": "+34600111222", "muted": false, "message": "No answer"]]),
    ]
}
#endif
