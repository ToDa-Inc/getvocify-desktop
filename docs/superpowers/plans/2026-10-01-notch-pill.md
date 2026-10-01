# Notch pill: live meeting island

Replaces the bottom-right floating pill (`MeetingPill.swift`) with an island anchored to the
top-centre of the screen, around the camera housing, like Dynamic Island.

## Problems it fixes (2026-10-01 feedback)

| Problem | Cause (verified) | Fix |
|---|---|---|
| Timer sticks / jumps | Elapsed only updated every 4th tick of a 125 ms web timer (`DesktopMeetingProvider.tsx`). WebKit throttles timers when the window is behind the call, so the pill moved in 4 s+ jumps. | Dashboard sends the clock (`startedAt`, paused time) once per change; the island ticks natively every second. |
| Only the last 4 turns, cut to 150 chars | `meetingOverlay` trims to `turns: 4`, `turnChars: 150`. | Island gets the whole conversation, untrimmed, in a scroll view pinned to the latest line. |
| Bubbles jump while text streams | Rows keyed by position; trimmed text start (`…`) changes every update; typing dots add and remove a row; window frame and SwiftUI animate against each other. | Keys from the turn's first segment; full text; pending words inline in the same bubble (dimmed); no row animations; window resizes instantly, only the shape animates. |
| Mic shown as "Them", last line "You" | Speechmatics labels mic-only audio `rep` correctly (live probe, 68 events) and the dashboard keeps it "You" (replayed). So the meeting capture carried the voice. Separately, a tail settled at stop had no time, skipped echo checks and landed at the end. | Per-side level meters on the island (also a 10 s check: talk with nothing playing, the Them meter must stay flat). Interims keep their start time so a settled tail sorts and is echo-checked like any final. |
| Not auto-triggered | No detection. | CoreAudio: when another app holds the mic ≥3 s and nothing is recording, the island shows "<App> · Record". Nothing records until clicked. |

## Idle (always on)

When nothing is recording, the Vocify mark sits beside the camera (36 pt ears). Click → a small menu
with **Record meeting** and Open Vocify; it folds away when the pointer leaves.

## Dev signing

Two keychain certificates named "Vocify Dev" made builds flip between them (`find-identity` order
varies), and macOS re-asked for Microphone/Screen Recording each flip. `scripts/lib/signing-ids.sh`
now prefers the certificate that signed `/Applications/Vocify.app`, and accepts a 40-hex hash.

## Journey

Rep is in Zoom/Meet, attention on the call. Vocify window is usually behind.

1. Call starts → island drops from the notch: app icon + "Record". One click starts. Ignored → it goes away when the call ends. × = not for this call.
2. Recording → island stays notch-sized: dot + time on the left ear, You/Them meters on the right. Never covers the call.
3. Needs context (what did they say? objection card?) → click island → drops down: controls, live help, full transcript. Scroll back freely; "Latest" returns.
4. Done → Stop in the island → review in Vocify (unchanged).

## Density map

| Layer | What |
|---|---|
| Surface (collapsed) | Recording dot, time, You/Them activity |
| Hover | Tooltips: "Show transcript", control names |
| Click (open) | Pause/Resume, Stop, live help card, full scrollable transcript, search, open Vocify, collapse |
| Never here | Settings, permissions, memo review |

## Edge cases

- **No notch / external display:** same top-centre island, sized from the menu bar height.
- **0 turns:** "Listening…" placeholder line.
- **400 turns:** lazy stack inside one scroll region; follows the bottom only while the reader is at the bottom.
- **Paused:** grey dot, time frozen, "Paused" in the right ear.
- **Start from island fails** (signed out, permission): Vocify window comes forward with the error.
- **Dictation/Siri briefly using the mic:** ignored by the 3 s threshold.

## Files

- `apps/macos/Sources/VocifyCompanion/MeetingPill.swift`: island window, geometry, views
- `apps/macos/Sources/VocifyCompanion/MicActivityMonitor.swift`: CoreAudio mic-in-use detection
- `apps/macos/Sources/VocifyCompanion/DesktopBridge.swift`, `VocifyCompanionApp.swift`: wiring
- `~/getvocify-recorder/src/lib/meeting-transcript.ts`: stable keys, full overlay, interim start
- `~/getvocify-recorder/src/features/desktop/DesktopMeetingProvider.tsx`: clock + levels to the shell
