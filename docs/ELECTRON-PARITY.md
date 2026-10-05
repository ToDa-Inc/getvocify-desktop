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
| Island: idle, call, starting, recording closed and open, stopped, post-call closed | Ported to `app/island` | 42 of 42 layout and click checks pass in Chromium, 1 skipped (see below). Sizes checked against hand-worked Swift numbers. Visual review done in a browser |
| Island: after-call card (CRM, Email, Notes tabs, field options) | Not ported | The largest remaining piece |
| Island controller (modes, hover, countdown, post-call actions) | Not ported | Swift `MeetingPillController`, about 700 lines |
| Bridge, recorder socket, drafts, hotkey, tray, updater | Not ported | See WINDOWS-PLAN section 13 |
| Helper protocol, fake helper, Swift and Windows helpers | Not started | WINDOWS-PLAN section 10 |

## Not verified yet

- **Real Electron window behaviour** (non-activating, first click acts, always on top, DPI): the harness `npm run test:island` in `app` is written, but could not be run from the agent sandbox. Run it in a normal terminal.
- **Transcript stays pinned to the latest line when the type list opens** (resize): fixed in code, but the check needs a visible page. Skipped in a hidden browser pane, runs in the Electron harness.
- **Side-by-side with the live Swift island**, and Dani's approval of the look.
- **Performance budgets** for the port (transcript delay, idle CPU and memory, first click latency) are not defined or measured.
- **Differential test**: the same recorded event stream through Swift `LiveTranscript` and the TypeScript port, outputs compared.

## Run

```bash
cd app && npm install && node island/build.mjs --preview
node --test core/*.test.ts                     # core port
../node_modules/.bin/electron test/island-shots.mjs   # real-window island checks and screenshots
# or serve app/island/dist and open preview.html?check=1 in any browser
```
