# Electron port: parity status

Pinned to Swift commit `add3bef` (origin/integrate/island on 2026-10-05). The Swift app keeps shipping; the port follows it.

## Detect drift

```bash
git log --oneline add3bef..origin/integrate/island -- apps/macos/Sources
```

Any commit listed touches Swift the port has not seen. For each: update the matching fixture and TypeScript, then move the pin.
The dashboard side of the contract (the `shell:state` keys read in `MeetingPillState.apply`) can also drift: diff
`src/features/desktop/DesktopMeetingProvider.tsx` and `src/lib/desktop-host.ts` in `~/getvocify` against the pin's date.

## What is ported and how it was checked

| Piece | State | Evidence |
|---|---|---|
| `VocifyCore` (14 files) | Ported to `app/core` | 100 Swift checks, each its own subtest; 145 of 145 pass; Swift reference passes. Same-author tests: behaviour outside the checks is unproven until differential testing |
| Island: idle, call, starting, recording closed and open, stopped, post-call closed | Ported to `app/island` | 42 of 42 layout and click checks pass in real Electron windows. Sizes checked against hand-worked Swift numbers. Visual review done in a browser |
| Island: after-call card (CRM, Email, Notes tabs, field options) | Not ported | The largest remaining piece |
| Island controller (modes, hover, countdown, stop grace, resume, pause, call type, live help) | Simulated in `app/main/src/demo.ts`, following `MeetingPillController`; it drives the island with a scripted call, not real audio | Runs in a real Electron window: call detected, record, streaming transcript, open card verified on screen. Post-call card actions not ported |
| Electron shell: island window on the notch plus a demo control window | `app/main` | Window size matches the Swift rules for this Mac (251x32 closed idle, notch 179 px). Run: `cd app && npm run start:demo` (add `ISLAND_OFFSET_Y=64` to sit below the Swift island) |
| Bridge, recorder socket, drafts, hotkey, tray, updater | Not ported | See WINDOWS-PLAN section 13 |
| Helper protocol, fake helper, Swift and Windows helpers | Not started | WINDOWS-PLAN section 10 |

## Not verified yet

- **Focus**: Electron logs `NSWindow does not support nonactivating panel styleMask` for the island. Whether a real click on the island takes focus from the call app is not yet tested. Test: put another app in front, click Pause on the island, check the menu bar still names the other app.
- **Glass blur** behind the open island: window-level vibrancy cannot follow the rounded shape while the window is larger than the island during animation, so Electron uses the denser opaque glass. Needs a native view or an accepted visual change.
- **App icon** of the call app in the closed call state: the demo shows a generic waveform; the real icon needs the Mac helper.

- **Real window behaviour not covered by the harness**: non-activating, first click acts without taking focus, always on top, DPI. The layout, size, click and scroll checks do pass in real Electron windows (42 of 42, including the transcript staying pinned to the latest line when the type list opens).
- **Side-by-side with the live Swift island**, and Dani's approval of the look.
- **Performance budgets** for the port (transcript delay, idle CPU and memory, first click latency) are not defined or measured.
- **Differential test**: the same recorded event stream through Swift `LiveTranscript` and the TypeScript port, outputs compared.

## Run

```bash
cd app && npm install && node island/build.mjs --preview
node --test core/*.test.ts                     # core port
../node_modules/.bin/electron test/island-shots.mjs   # real-window island checks and screenshots (needs a normal terminal session, not the agent sandbox)
# or serve app/island/dist and open preview.html?check=1 in any browser
```
