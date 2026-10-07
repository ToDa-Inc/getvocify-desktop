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
- **Cost of the island (measured 2026-10-05 with `app/test/perf-island.mjs`, real transparent always-on-top windows, 3 runs each, CPU as share of one core).** An earlier note here said 22%; that came from `ps`, which reports a decaying average, and was wrong.

  | Closed island | Before | After |
  |---|---|---|
  | idle | 0.03% | 0.07% |
  | recording, silent | 2.07% | 0.47% |
  | recording, someone speaking | 2.60% | 1.17% |
  | recording, speaking, reduced motion | 0.33% | 0.63% |
  | open card, speaking | 1.97% | 2.03% |

  What changed: the voice wave no longer re-renders React 24 times a second (levels bypass React, the loop only runs while there is sound), the timer ticks once per second on the boundary, the typing dots and countdown line are CSS-only, and the pulsing dot steps instead of animating smoothly. Run-to-run noise is about plus or minus 0.3. The open card did not improve and is the next target.
  **Memory is the larger cost:** the island alone is 4 processes and about 250 to 270 MB (main 98, GPU 48, utility 19, renderer 85 to 95). The installed Swift Vocify is about 61 MB native plus about 67 MB for its WebKit processes, at 0% CPU when idle. The dashboard window adds more on top in Electron.
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


## Caught up with the Mac app (2026-10-06)

The port was made from the Mac code at `add3bef`. Four Mac commits landed after it and are now ported:

- Stop and hang-up both pause and wait for Resume (a hang-up no longer ends the call at once); the stopped card has **Resume** (text) and **Finish** (button), and Finish ends the call now.
- A new `finishing` state from the end of the recording until its memo is being written: spinner on the closed island, the dashboard's line ("Finishing the transcript", "Sending the call to Vocify"), and on a failure the island opens with the dashboard's message and **Open Vocify**; it gives up after 30 s with no memo. The dashboard drives it through `shell:state` `finish`.
- The island keeps the dashboard page alive and does not restart for an update while finishing.
- A CRM page read that outlasts the click on Record still counts.
- `shell.relaunch` exists in the bridge.
- The island remembering it is signed in across launches was already ported.


## Glass, card and placement (2026-10-06, second pass)

- The island sits at the very top of the screen around the camera on a Mac (`enableLargerThanScreen`), as the Swift one does.
- The after-call card was rewritten from `PostCallMenu`: capsule tabs with icons and counts, changes grouped under captions
  with no box, the email draft box (and its "writing" state), the editable note box, the Swift wording for every stage, and
  the approve payload the Mac sends (unticked changes in `omit`, only changed picks in `edits`, the note when touched).
- Free-text values (a deal description) are not editable in the card: the dashboard applies only picks from a field's
  options (`withEdits` in getvocify `src/lib/post-call.ts`), so typed text would be dropped. The Swift card sends them to
  Vocify too ("Edit it in Vocify").
- No focus rings and no pointing-hand cursor, as on the Mac.
- Blur behind the island is not available: Electron's vibrancy (Mac) and acrylic (Windows 11) fill the whole rectangular
  window, which also grows for dropdowns, so it would show square frosted corners and blocks. The open island is solid dark
  instead, so nothing behind it shows through the text. The dropdowns blur the island content under them.
