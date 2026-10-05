# Vocify for Windows: plan

Status: draft for review, written 2026-10-05. Nothing in this plan is built yet.
Every claim marked **[verified]** was read from the code in this repo or in `~/getvocify` (origin/staging).
Every claim marked **[verify in Phase 0]** is an assumption that must be proven on a real Windows machine before it is relied on.

## 1. Goal

A Windows build that does what the Mac app does today: sits at the top of the screen, notices a call, records the
mic ("You") and the call's audio ("Them") without a bot, shows the live transcript and the after-call CRM card in the
island, and hands the memo to the same dashboard. The notch does not exist on Windows, so the island becomes a pill
hanging from the top-centre of the screen.

## 2. Review of the first proposal (what was wrong or missing)

The first answer said "Electron shell, React island, small C# helper". Reviewing it against the code:

1. **The recorder must not live in a web renderer.** The Mac app moved recording out of the web page into
   `NativeRecorder` because a hidden or busy page throttled the call (see the header of `NativeRecorder.swift` and the
   2026-10-01 notch plan: "WebKit throttles timers when the window is behind the call"). Chromium throttles hidden
   windows too. First answer proposed a hidden renderer. Corrected: capture in a native helper, socket and transcript
   in the Electron **main** process (never throttled).
2. **The helper is not "small".** Mac equivalents: `NativeRecorder` 522 lines, `MicActivityMonitor` 217,
   `ActiveSpeakers` 64, `CrmPageReader` 66, plus `VocifyCore` (about 1,000 lines of transcript, echo filter, speaker
   timeline). Splitting as below keeps the helper to capture, detection and UI Automation only.
3. **Missed: the dashboard hard-codes macOS.** `src/lib/desktop-host.ts` types `platform: "darwin"` and
   `isDesktopHost()` returns true only for it. `useDesktopPermissions.ts` defaults to `"darwin"`.
   `DesktopPermissionsPanel.tsx` and `DesktopMeetingProvider.tsx` show "Screen & System Audio Recording" and
   "Quit (⌘Q) and reopen" copy. **[verified, origin/staging]**
4. **Missed: the CI dashboard pin is stale.** `release-mac.yml` builds the dashboard from
   `feat/desktop-meeting-recorder` (last commit 2026-09-28, "WIP"). The native-recorder, call-detection and post-call
   bridge code the Mac app depends on is on `origin/staging`, not on that branch. A CI-built DMG can therefore ship a
   dashboard without those features. **[verified]** Windows must not copy this; see section 7.
5. **Missed: the legacy Electron shell is the old generation.** `electron-main.mjs` and `preload.cjs` expose only the
   August bridge (system-audio, permissions, shell, saas). They have none of `recorder`, `crm`, `shortcut`, `drafts`,
   or the post-call and call-type channels. Its 46 tests pass, and its tray, SaaS proxy and loopback code are reusable,
   but it is a head start, not a baseline. **[verified]**
6. **Not documented: why the team left Electron on 2026-09-28.** The commits do not say. Do not assume the reason;
   ask (section 9) before committing to Electron.
7. **Missed Windows-specific traps** (section 6): separate default devices for "console" and "communications",
   Bluetooth headsets changing sample rate when the mic opens, loopback delivered as float32 at the mix rate (the
   existing WPF stub labels it 16 kHz PCM, which is wrong), code signing and SmartScreen, and updater credentials.

## 3. Architecture

```
Dashboard (React, from ~/getvocify)           Island (React page, transparent frameless window)
        |  window.vocifyDesktop                        ^  shell:state JSON (same keys as the Mac island)
        v                                              |
Electron main (Node)  --------------------------------+
  - bridge ops, SaaS proxy, drafts, tray, hotkey, updater, logs
  - live socket (ticket, reconnect, backlog), transcript assembly (TS port of VocifyCore)
        ^  length-prefixed PCM + JSON events over stdio
        |
vocify-win-helper.exe (C#/.NET 8, signed)
  - mic capture (WASAPI) and loopback capture (WASAPI), 16 kHz s16le mono, one shared clock
  - mic-in-use detection by process (WASAPI sessions)
  - UI Automation: Zoom active speaker, browser tab URL (later phases)
```

This mirrors the existing `vocify-tap` pattern (helper streams PCM on stdout, `feedS16le` consumes it).

**Decision (2026-10-05): Electron for Windows only; the Mac stays native Swift.** Reasons, in order of weight:
1. It reuses what exists: the legacy shell's tray, SaaS proxy, preload and 46 passing tests, and the team already
   writes React and JavaScript. The only .NET code is the helper.
2. It bundles its own Chromium, so it does not depend on the WebView2 runtime being present or current on a
   locked-down company PC.
3. Frameless transparent always-on-top windows are well supported, which the island needs.
4. A per-user installer needs no admin rights (see 7e for when IT will want a different one).

Costs to accept: a larger install and more memory than a native app (not measured yet, measure in Phase 0); two
runtimes (Node and the .NET helper); and **the island exists twice** (SwiftUI on Mac, React on Windows), so every island
change is made twice. Mitigation: both consume the same `shell:state` keys, and island changes are reviewed against the
same spec and screenshots.

Alternatives considered: WPF plus WebView2 (transparent windows are a known weak spot with WebView2 **[verify in
Phase 0]**); Tauri (smaller, but adds Rust the team does not use); native WinUI (rewrites about 2,700 lines of island
and gives up the fast web iteration). Phase 0 still builds the Electron island first and checks it; fall back to WPF
plus WebView2 only if Electron fails the gate. The unanswered question of why the Mac moved off Electron stays open,
but the Mac reasons (notch, per-app mic flags, ScreenCaptureKit) do not apply on Windows.

## 4. Bridge parity (the contract)

The island's input is the `shell:state` JSON read in `MeetingPillState.apply` **[verified]**: keys `paused`,
`recorderReady`, `callAudioLost`, `postCall`, `liveType`, `callContact`, `clock`, `levels`, `assist`, `overlay`.
The Windows island consumes the identical keys. The dashboard side does not change for it.

| Bridge op | Windows implementation | Notes |
|---|---|---|
| `log:error` | Append to `%APPDATA%\Vocify\logs` | Rotate by size |
| `saas:request` | Reuse `lib/saas.js` | Host allow-list already ported from `SaasProxy.swift` |
| `recorder:start/pause/stop` | Main process + helper | Ticket-first socket, reconnect up to 5, 30 s backlog, as Mac |
| `recorder:*` events (transcript, levels, warning) | Main process to dashboard and island | Snapshot to dashboard at most 1 per second, as Mac |
| `system-audio:start/stop` | Return unsupported unless the staging dashboard still calls it | Read `DesktopMeetingProvider.tsx` first |
| `shortcut:get/set/clear` | Electron `globalShortcut` | `meta` means the Windows key and cannot be registered reliably; default and conflicts to be chosen in Phase 3 |
| `permissions:status/request/open/guide/appInfo` | No per-app prompt exists on Windows. Status comes from a real capture attempt; "open" goes to `ms-settings:privacy-microphone` | Copy must branch by platform |
| `shell:state`, `shell:command`, `overlay:*`, `shell:resize`, `shell:open-external` | Main process | Already in the legacy shell |
| `drafts:save/list/remove` | One JSON file per draft in `%APPDATA%\Vocify\meetings`, same id regex | Port of `MeetingDrafts.swift` |
| `crm:pages` | Phase 4: browser extension reports URLs of all tabs (primary), UI Automation reads the active tab (fallback) | The Mac reads every tab through AppleScript. UI Automation alone sees only the active tab, which during a Meet call is the Meet tab, not the CRM, so the extension is what makes this work |
| `crm:open-automation-settings` | Not applicable | Hide the control |

Add one change on the dashboard: `platform: "darwin" | "win32"` and a `capabilities` object
(`callDetection`, `activeSpeakers`, `crmPages`, `island`). The dashboard checks capabilities, not platform names, so a
missing Windows feature degrades instead of breaking. Keep a single conformance test that runs the same bridge
checks against both implementations.

## 5. Phases, each with an exit gate

| Phase | Work | Exit gate (all must pass on a real Windows 11 laptop) |
|---|---|---|
| 0. Spike, about 3 to 5 days | Island window A vs B; helper that captures mic and loopback and writes a WAV; list mic sessions by process | Island never takes focus from a Zoom call and is clickable on first click; a 10-minute Zoom call gives two clean 16 kHz tracks; process names for Zoom, Teams and Chrome appear while in a call; decision recorded in this file |
| 1. Record to memo, about 1.5 to 2 weeks | Dashboard platform and capabilities change; Electron main with bridge ops, socket, transcript port with its tests; helper streaming; drafts | A 30-minute call produces a memo in the dashboard with correct You/Them; killing the network for 20 s loses nothing; quitting mid-call keeps the draft |
| 2. Island, about 1.5 to 2 weeks | Screen geometry behind one injected provider (so the Mac spike in 7f stays cheap); five modes (idle, call, starting, recording, post-call), hover, countdown, transcript scroll, after-call tabs, DPI and multi-monitor placement, reduce-motion | Same screenshots-vs-Mac review as the Mac plan's density map; 200% DPI and a second monitor look right; island hides over exclusive-fullscreen apps without crashing |
| 3. Detection and shortcut, about 1 to 1.5 weeks | Mic-session call detection with the 0.3 s settle, 120 s after-call quiet and 3 s hang-up grace from `MeetingPillController`; hotkey; tray | Zoom, Teams, Meet in Chrome and a HubSpot call in the browser each offer "Record" within 1 s of the mic opening, and dictation or a browser tab recording does not |
| 4. CRM tab reading, about 1 to 1.5 weeks (required, not optional) | Browser extension for Chrome and Edge that reports CRM page URLs from all tabs to the app, plus a UI Automation active-tab read as a fallback | During a Google Meet call with the HubSpot contact open in another tab, the island shows that contact within 2 s; same for a HubSpot call; nothing but CRM URLs and the call-app name leaves the PC |
| 5. Speakers, optional, about 3 days | Zoom active speaker through UI Automation | Ships only if a real Zoom call proves tile names are readable; otherwise the capability flag stays false |
| 6. Distribution and updates, about 1.5 weeks | Installer, signing, auto-update, release rings, diagnostics (section 7b and 7c) | A teammate installs from the link and updates from one build to the next without losing a draft; an update never lands during a recording |

Estimates are for one developer who has a Windows device, and are rough. Phase 0 exists to replace them with real numbers.

## 6. Risks and unknowns, each with an owner phase

| Risk | Why it matters | Handled in |
|---|---|---|
| Default "console" and "communications" output devices differ | Loopback of the wrong device records silence for "Them" | Phase 0: capture the device the call app uses, else watch both |
| Bluetooth headset switches to hands-free and changes sample rate | Loopback format changes mid-call and the track breaks | Phase 1: restart capture on format change, keep the shared clock |
| Loopback sends nothing while the call is silent | Clocks drift; the Mac handles this with a 0.3 s slip rule | Phase 1: port `maxClockSlip` logic |
| Speakers instead of headset | The mic hears the call; the echo filter must work with Windows latency | Phase 1: test on laptop speakers |
| Mic privacy toggle off or blocked by company policy | There is no prompt; capture just fails or is silent | Phase 1: detect and show guidance |
| Teams or Chrome hold a mic session outside calls | False "call" offers | Phase 3: filter and tune against real sessions **[verify in Phase 0]** |
| Zoom tiles may not expose speaker names through UI Automation | Active-speaker naming may be impossible | Phase 5: capability flag stays false if not proven |
| CRM tab is not the active tab during the call | Active-tab reading misses the contact in the most common case | Phase 4: extension reads all tabs |
| Extension distribution | Chrome Web Store review takes time; managed PCs may block unpacked extensions | Phase 4: start the store listing early, use a policy force-install for teammates |
| Unsigned builds | See section 7c | Phase 6 |
| Auto-update from a private GitHub repo | Needs a token in the app, which must never ship | Phase 6: publish update files to a public or authenticated bucket instead |
| Always-on-top over fullscreen video calls | Island may not draw over exclusive fullscreen | Phase 2: test Zoom fullscreen and shared-screen modes |
| Island covers app controls at top-centre | Position is a design choice here, not given by a notch | Phase 2: default top-centre, user can move it |
| Minimum Windows version | WebView2/Electron and per-process audio APIs vary by build | Phase 0: state the minimum after testing |

## 7. How we keep control

- **Contract:** `desktop-host.ts` is the single bridge type. Both shells are tested against the same conformance
  checks. Any new op lands in the type first.
- **Pinned inputs:** the Windows workflow builds the dashboard from a commit SHA or tag, never a floating branch.
  Fix the Mac pin the same way (item 4 in section 2).
- **CI:** a Windows job runs the transcript port tests and the helper's unit tests. Disable the existing
  `release-windows.yml`, which publishes an unsigned WPF stub on every push to `apps/windows`.
- **Cannot be tested from the Mac:** audio, window focus and DPI need a real Windows device. A VM on Apple silicon is
  not a substitute for call audio.
- **Rings:** dev builds, then internal teammates, then a beta channel, then general. Each ring needs a written
  pass of the Phase gate checks first.
- **Switches:** a setting to turn call auto-detection off, and a minimum-app-version check from the API so a bad build
  can be retired.
- **Diagnostics:** logs under `%APPDATA%\Vocify\logs`, a "copy diagnostics" action, and the measured transcript delay
  already built for the Mac (`7aeaa2d`).
- **One page of truth:** this file. Update the decision record and the gates as Phase 0 results arrive.

## 7b. Updates (what changes when, and how it reaches users)

Today on the Mac there is **no updater**: no Sparkle, no feed, nothing. Users download a new DMG by hand. **[verified]**
The Mac app also **bakes the dashboard into the build** (`EmbeddedDashboardServer` serves the bundled Vite output), so
every dashboard change needs a new app release. **[verified]** Windows should not inherit either problem.

| Thing that changes | How it ships on Windows | Control |
|---|---|---|
| Dashboard (most changes) | The shell loads the dashboard from the hosted app URL, like the legacy shell (`dashboardOrigin` in `lib/shell.js`), so it updates on deploy with no user action | The bridge reports `contractVersion` and `capabilities`; the dashboard shows "update Vocify" if the shell is older than it needs, and never calls an op that is missing |
| Shell, island, helper, transcript logic | Auto-update: download in the background, apply on next quit or restart | Never apply or restart during a recording or with an unsent draft; update files live on a public or authenticated bucket (never a token in the app); channels: beta and stable |
| Backend API | Unchanged | API can refuse shells below a minimum version, which is the kill switch for a bad build |
| Mac | Add Sparkle (or equivalent) so the Mac stops depending on manual DMGs | Same rules: no update during a call |

Trade-off to accept: a remote dashboard needs the network. Meeting drafts are already saved locally, so a call is not
lost offline, but the memo review screen needs connectivity. If offline use matters, ship a bundled copy as a fallback.

## 7c. Code signing on Windows

Not technically required: an unsigned installer runs. But it is not "install easily for everyone":
- Windows SmartScreen shows "Windows protected your PC / Unknown publisher" and the user must click More info, then Run anyway.
- Windows 11 **Smart App Control**, when on, blocks unsigned apps with no override. **[verify in Phase 0 on the test PC]**
- Managed company PCs often block unsigned installers by policy, and antivirus products distrust unsigned programs
  that record audio.
- A new signature also starts with no SmartScreen reputation, so even signed builds can warn at first.

Plan: your own PC runs unsigned builds through Phase 5. Because customers use managed devices (7e), sign the
installer, app and helper before the first customer pilot, not after. Which signing service the company can use
is an open question.

## 7e. Company-managed devices (Dani: most users)

This changes two earlier assumptions. Unsigned builds are no longer acceptable for customer PCs, and the extension
cannot be installed by the user alone.

| Constraint on managed PCs | Consequence | Plan |
|---|---|---|
| Unsigned installers and executables are commonly blocked (SmartScreen policy, AppLocker, Windows Defender Application Control) | The "teammates run it unsigned" shortcut in 7c does not hold for customers | Sign installer, app and helper before the first customer pilot |
| Standard users cannot install per-machine software | Per-user install works only if policy allows running from the user profile, which AppLocker often does not | Ship two forms: per-user installer, and an MSI (or similar) IT can push silently with Intune or SCCM |
| IT controls Chrome extensions | A user cannot add the CRM extension if installs are blocked | Publish the extension on the Chrome Web Store (needed for policy force-install by extension ID); give IT a one-page allow-list and force-install instruction; fallback is the active-tab UI Automation read |
| IT may disable "let desktop apps access the microphone" | Capture silently fails | Detect it and show a message that names the setting, so the rep can ask IT |
| IT may block auto-update downloads or unknown hosts | Updates never arrive | Document the update host; support an IT-managed update mode (MSI re-push) with the in-app updater off |
| Network egress filtering | The live transcription socket and API must be reachable | List required hosts for IT (API, live service, update host) |

New open questions for the pilot company: which tool manages devices, whether Smart App Control or AppLocker is in
force, and whether their Chrome allows force-installed extensions.

## 7d. Why the Mac app is SwiftUI and not Electron

The repo does not record the reason (the pivot commits describe what was built, not why). What the code shows is that
the island depends on macOS-only APIs: notch geometry from screen safe-area insets, a non-activating panel above the
menu bar, CoreAudio per-process "is using the mic" flags (the basis for call detection), ScreenCaptureKit for the
call's audio, Accessibility for Zoom speakers, AppleScript for browser tabs, and Carbon hot keys. **[verified]**
Electron can reach these only through native helpers, and the old Electron shell already needed a Swift helper
(`vocify-tap`) for system audio. Granola is, I believe, Electron with native pieces too, which is the same shape as
this plan; that is from memory and not checked here. The honest conclusion is that the Mac choice was about native
audio and permissions, and on Windows those pieces are provided by one helper, so Electron is a reasonable shell there.
Still ask whoever made the 2026-09-28 call for the actual reason (section 9).

## 7f. Should the Mac move to Electron too? (asked by Dani 2026-10-05)

Appeal: one island, one transcript and socket implementation, one updater and one team skill set, and no more
building every island change twice. The Windows work already produces most of it: the React island, the TypeScript port
of `VocifyCore`, the socket and reconnect logic, and the bridge in Electron main.

What would still be native Swift on the Mac even under Electron, about 600 lines that already exist: call detection
(`MicActivityMonitor`, 217), ScreenCaptureKit and mic capture (`MeetingCapture` 187, `MicCapture` about 60), Zoom
speakers (`ActiveSpeakers`, 64) and CRM tab reading (`CrmPageReader`, 66), plus a notch measurement. What would be
retired: `MeetingPill.swift` (2,736), the app shell, the bridge and the recorder's socket half.

Why not now:
- The Mac island is approved and under daily iteration (about 30 island commits in two days). A rewrite risks losing
  approved styling, spring animation and the recent click, hover and long-transcript performance work. Dani's rule:
  do not restyle it unasked.
- Unproven on Electron: placing a window over the menu bar beside the notch, reading notch size (Electron's screen API
  does not expose it, a Swift helper would), first-click-without-activating behaviour, and idle memory of an
  always-visible Chromium window. **[verify in a spike]**
- The Mac is the product being tested on real calls right now; stability matters more than code reuse.

Decision: **not now, but keep the option open at no extra cost** (staged path in section 10). Build the Windows island with the screen geometry
(notch width, bar height, anchor point) behind one injected provider, and keep it free of Windows-only code. After
Windows Phase 2, run a one-week Mac spike that runs the same island in Electron with a small Swift geometry helper.
Move the Mac only if all of these hold: the island sits on the notch within 1 pt of the native one, the first click
acts without taking focus from Zoom, idle memory and CPU are within an agreed budget, and Dani signs off the
side-by-side screenshots. Otherwise the Mac stays native and only the shared logic is reused.

## 8. Reused as is

`lib/saas.js` allow-list and proxy; tray menu template; `lib/pcm.js`; the 46 existing tests; Mac `VocifyCoreChecks`
cases as the spec for the TypeScript transcript port; the notch-plan "journey" and "density map" as the island spec.

## 9. Open questions and answers so far

Answered by Dani on 2026-10-05:
- Test device: the Windows machine used for Google Meet and HubSpot calls. Both must work in the Phase 3 gate.
- CRM tab reading is highly important: promoted to its own required phase (Phase 4).
- Dani expects Windows needs no code signing: partly true, see 7c. For managed customer PCs it is needed, see 7e.
- Browser: Chrome. Users are on company-managed devices (7e).

Still open:
1. Why was Electron dropped on 2026-09-28 for the native Mac app? (Decides option A vs B.)
2. Is the test PC personal or company-managed, and is Smart App Control on?
3. Is there a company code-signing identity usable for Windows?
4. Which device-management tool and policies does the pilot company use (Intune, AppLocker, Chrome extension policy)?

## 10. Target architecture: Electron on both, reached in stages (redesign, 2026-10-05)

The smartest end state is one Electron app for Mac and Windows with the OS-specific parts behind **one helper protocol**.
That protocol is the seam: it lets Windows ship first, lets the Mac move later (or never) without waste, and lets the
whole app be tested without audio hardware.

```
Electron app (same code on Mac and Windows)
  main process   bridge ops, live socket, transcript (TypeScript), state store, drafts, updater, tray,
                 hotkey, logs, test hooks
  dashboard      hosted app URL (7b)
  island         React page, screen geometry from an injected provider
  helper         ONE protocol, two implementations:
                   vocify-helper-win  (C#/.NET 8)  WASAPI mic + loopback, mic sessions, UI Automation
                   vocify-helper-mac  (Swift)      ScreenCaptureKit, CoreAudio mic flags, Accessibility,
                                                   notch geometry, split out of today's Swift files
  extension      Chrome: CRM and call-page tabs, talks to the helper by native messaging
                 (restricted to the extension id) or a token-guarded loopback socket; decide in Phase 4
```

Helper protocol (JSON lines for control and events, length-prefixed binary frames for PCM, versioned, with a
`hello` that reports `protocol`, `platform` and `capabilities`): `audio.start/stop`, `pcm {channel, clock, bytes}`,
`audio.lost`, `mic.sessions`, `geometry.get`, `speakers.read`, `tabs.read`, `permissions.status/request`.

A **fake helper** (a Node script that replays a recorded two-channel WAV and scripted events: a call starting, a device
change, a mic loss) implements the same protocol. With it the entire app runs and is tested on any machine, including
this Mac and hosted CI, with no microphone, speaker or Windows PC.

### Stages (the Mac keeps shipping Swift the whole time)

| Stage | Work | Needs Windows PC? |
|---|---|---|
| S0 | Helper protocol spec and fake helper. TypeScript port of `VocifyCore` with the `VocifyCoreChecks` cases as its tests. Live socket and reconnect logic in Electron main, tested against a mock live server | No |
| S1 | Island as a standalone React page driven by recorded `shell:state` fixtures, one screenshot per mode; dashboard `platform` and `capabilities` change | No |
| S2 | `vocify-helper-win` (Phase 0 and 1 of section 5), real capture on the test PC; Windows alpha build | Yes |
| S3 | Windows phases 2 to 6 of section 5; first managed-PC pilot | Yes |
| S4 | Mac spike (7f): split today's Swift capture, detection and geometry code into `vocify-helper-mac`, run the same island in Electron | No, Mac only |
| S5 | If the 7f criteria pass, the Mac moves and the SwiftUI island is retired; if not, the Mac stays native and only S0 and S1 are shared | No |

Why this order: S0 and S1 are the shared, risk-free value and can start today. They are needed whether or not the Mac
moves. Everything Windows-specific is isolated in one helper.

## 11. Build and test strategy

### What I found about this machine (2026-10-05)
Apple silicon Mac, **2.8 GiB free disk**, no VM software, no .NET SDK, Node 22, Swift 6.1, ffmpeg, gh. A Windows
virtual machine is not practical here (it needs tens of GB) and would not prove call audio anyway. **A real Windows PC is
required**, which matches the test device already planned.

### How I can test
| Option | What I can do | Limits |
|---|---|---|
| Claude Code running on the Windows PC (best) | Build, run the app, run PowerShell checks, read logs, drive Electron through Playwright | I cannot hear audio; GUI control of other apps (Zoom) is not available to me there **[verify]** |
| SSH from this Mac to the PC (OpenSSH server, ideally over a private network such as Tailscale) | Same commands, pull logs and screenshots back to this Mac to read | An SSH session is not the logged-in desktop, so screenshots and window checks must run as a scheduled task in the interactive session **[verify in Phase 0]** |
| GitHub Actions `windows-latest` only | Build, unit tests, installer build, Electron end-to-end with the fake helper | Hosted runners have no real audio devices, so no capture tests |

Recommendation: first or second option, plus hosted CI. Real calls stay human-driven; I read the logs and diagnostics.

### Test layers
| Layer | Where | What it proves |
|---|---|---|
| L0 Unit | This Mac, CI | Transcript assembly, echo filter, speaker timeline, helper protocol codec, reducer for `shell:state`, resampler and framing |
| L1 App end-to-end with fake helper | This Mac, CI (Mac and Windows runners) | Whole app flow: call offered, record, live transcript, network cut 20 s and restore, quit mid-call keeps draft, update deferred during a call, bridge conformance against the dashboard contract. Playwright drives Electron; island screenshots per mode from fixtures |
| L2 Helper integration | Real Windows PC | Capture format and clock: play a known WAV through the default output (loopback) and a tone into the mic (virtual cable), then check sample rate, channel labels, clock alignment and level meters |
| L3 Window behaviour | Real Windows PC | After clicking the island, the foreground window is unchanged; topmost and no-activate flags; first click acts; DPI 100% and 200%; second monitor; fullscreen app; read through PowerShell and Win32 calls, not by eye |
| L4 Call detection | Real Windows PC | A local Chrome test page that opens the mic triggers the offer; Zoom, Teams, Meet and a HubSpot call each trigger it; dictation and a plain mic test do not |
| L5 CRM reading | Real Windows PC, managed Chrome | With Meet in front and the HubSpot contact in another tab, the island shows the contact within 2 s |
| L6 Real calls | Test PC, human-driven | 30 and 120 minute calls: You/Them accuracy, transcript delay report (`7aeaa2d`), memory and CPU over time |
| L7 Managed-PC rehearsal | Test PC under IT-like policy | Standard-user install, MSI push, AppLocker rule, extension force-install, Smart App Control state, mic policy off |

Every layer above L1 reads app state through a **test hook** (a local-only diagnostic channel enabled by a flag that
returns island state, helper events and transcript as JSON), so assertions never depend on screenshots alone.
Screenshots are for design review against the Mac island.

### Test matrix (press on everything)
- Call apps: Zoom, Teams, Meet in Chrome, HubSpot calling in Chrome, a Slack huddle.
- Audio: wired headset, Bluetooth headset (sample-rate switch), laptop speakers (echo), USB mic, device unplugged mid-call, default device changed mid-call, "communications" device different from default.
- Display: 1080p at 100%, 4K at 200%, two monitors, mixed DPI, taskbar on another edge, fullscreen shared screen.
- Windows: 10 and 11, standard user and admin, company-managed.
- Network: drop 20 s, packet loss, VPN or proxy, offline start.
- Lifecycle: sleep, lock, wake, quit mid-call, crash, update during a call, 2 hour call.
- Privacy and policy: mic access disabled, extension blocked, unsigned installer blocked.
- Security: only CRM URLs and the call-app name leave the PC; helper accepts commands only from the Electron parent; renderer has no Node access.

### Definition of done for each stage
A stage is done when its layers pass, the result is written into this file, and a person has reviewed screenshots or
logs for it. No stage is called done on "builds and runs".

## 12. Alternatives considered

| Option | Verdict |
|---|---|
| A. Electron on both, staged (section 10) | **Recommended end state.** One island, one TypeScript core, one updater; native only behind the helper |
| B. Electron on Windows, Mac stays Swift | The fallback if the 7f spike fails. Costs two islands, but loses nothing from A's stages |
| C. Tauri on both | Smaller install, but adds Rust and still needs native helpers; the webview throttling lesson from the Mac applies; no gain over A for this team |
| D. Native on both (SwiftUI and WinUI) with a shared Rust core | Best fidelity, highest cost: two islands plus a Rust core nobody on the team writes |
| E. Avalonia or MAUI (one C# UI on both) | One codebase, but C# is new to the team, the island's glass and animation polish would have to be rebuilt, and the dashboard still needs a web view |
| F. Browser extension with Picture-in-Picture only | Cannot capture Zoom or Teams desktop audio and has no mic detection; rejected as the product, though the extension is still needed for CRM tabs |
| G. WPF with WebView2 on Windows | Fallback to A for Windows only if Electron fails the Phase 0 island gate |

What would change the recommendation: if the Phase 0 island or the 7f spike fails on focus, notch placement or memory,
fall back to B (Mac) or G (Windows). If the team learns the reason the Mac left Electron applies on Windows, revisit
before S2.

## 13. Swift to Electron, file by file, and the revised build order (2026-10-05)

Dani's setup changes the order in section 10. The Windows PC will be reached through AnyDesk, which is slow for
iteration, and **this Mac can run and fully test Electron**: generated speech (`say`) played with `afplay` gives
deterministic "prospect" audio through the real output, the app's own screenshots and a test hook give assertions, and
AnyDesk is installed here. So the Mac goes first and Windows follows as a new helper plus OS shell.

### Mapping of today's Swift (sizes read from the repo)

| Swift today | Lines | Electron destination |
|---|---|---|
| `MeetingPill.swift` views | about 2,000 of 2,736 | React island |
| `MeetingPill.swift` controller (modes, countdown, hover, post-call actions, panel placement) | about 700 | TypeScript state machine in Electron main; window placement from helper geometry |
| `VocifyCore` (10 files) | about 955 | TypeScript port; `VocifyCoreChecks` (227) become its tests |
| `NativeRecorder.swift` socket, reconnect, backlog, lag timing | about 460 of 522 | TypeScript in main |
| `MicCapture` (in `NativeRecorder.swift`) | about 60 | Stays Swift in `vocify-helper-mac` |
| `MeetingCapture.swift` (ScreenCaptureKit) | 187 | Stays Swift in the helper |
| `MicActivityMonitor.swift` | 217 | Stays Swift in the helper, emits `mic.sessions` |
| `ActiveSpeakers.swift`, `CrmPageReader.swift` | 64, 66 | Stay Swift in the helper |
| `DesktopBridge.swift`, `bridge.js` | 361, 108 | Electron preload and main IPC |
| `SaasProxy.swift` | 63 | Reuse `lib/saas.js` |
| `MeetingDrafts.swift` | 42 | TypeScript |
| `RecordShortcut.swift` | 145 | Electron `globalShortcut` |
| `PermissionGuideController.swift`, `SystemAudioPermission.swift` | 273, 31 | Helper reports status; guide UI in React |
| `EmbeddedDashboardServer.swift`, `WebDashboardView.swift` | 94, 146 | Replaced by a window loading the hosted dashboard |
| `VocifyCompanionApp`, `CompanionModel`, `API`, `OverlayPanel`, `PCMEncode`, `AppSigning` | 592, 288, 116, 86, 38, 42 | Retired (legacy SwiftUI screens and the old shell) |

About 600 lines of Swift remain as the helper, and they already exist.

### Revised stages

| Stage | Where it runs | Gate |
|---|---|---|
| E0 | This Mac | Protocol spec, fake helper, TypeScript `VocifyCore` port passing the ported checks, live socket against a mock server |
| E1 | This Mac | Island as React with state fixtures; one screenshot per mode; side-by-side with the Swift island approved by Dani |
| E2 | This Mac | `vocify-helper-mac` split out of the Swift files; real mic and generated call audio recorded end to end; island on the notch within 1 pt, first click acts without taking focus from the call, idle memory and CPU recorded |
| E3 | This Mac | Mac decision (7f): Electron replaces Swift only if E2 passes and Dani signs off |
| W1 to W3 | Windows PC over AnyDesk | `vocify-helper-win`, island window behaviour, call detection, CRM extension, managed-PC rehearsal, as in section 5 |

Mac permissions under Electron (microphone, screen recording, automation) are attributed to the app that launches the
helper; confirm in E2 that the helper inside the signed bundle triggers the prompts under the app's name **[verify in E2]**.
Hardened runtime, notarization and entitlements need the existing `notarize-dmg.sh` flow adapted for Electron.
Branch work starts from a clean `feat/electron` cut from `origin/integrate/island` (see `docs/BRANCH-CLEANUP.md`).

## 14. Fastest honest route to real use (2026-10-05, from measurements and code, not opinion)

### What is established

| Fact | Source |
|---|---|
| Island in Electron: layout and clicks pass in real windows; CPU while recording about 0.5% silent and 1.2% speaking, 2% with the card open | `app/test/perf-island.mjs`, 3 runs each |
| Electron island memory floor is about 220 MB with the island alone; four Chromium switches were tried (in-process GPU, low-end device mode, both, JS lite mode): none lowered it, two raised it | same script, `--flags=` |
| Swift Vocify on this Mac: about 50 to 61 MB native plus about 67 MB WebKit helper processes, 0% CPU idle | `ps` and `top` |
| Electron apps already in daily use here: Granola 263 MB in 9 processes, Slack 297 MB, Discord 370 MB at the moment of measuring (their activity at that moment is unknown) | `ps` |
| The dashboard on origin/staging already has a full recording path for a shell with no native recorder: mic from the browser, call audio from `bridge.systemAudio.onPcm`, socket and transcript in the page, levels and overlay pushed through `shell.setState` | `DesktopMeetingProvider.tsx` lines 774 to 870 |
| That path is blocked on Windows only by the platform check `platform === "darwin"` in `desktop-host.ts` and `useDesktopPermissions.ts` | origin/staging |
| The legacy Electron shell already enables Chromium loopback capture (`audio: 'loopback'`) | `electron-main.mjs` line 378 |

### Not established (must be measured on the Windows PC)

- Memory and CPU of Electron on Windows, and of a WebView2 host as the alternative.
- Whether Chromium loopback captures a Zoom, Meet or HubSpot call cleanly, including headset changes.
- Whether the page's timers and audio callbacks stay on time when the window is behind the call. This is why the Mac moved recording out of the web view.

### Route

1. **Mac stays Swift.** Electron costs about four times the memory for no gain a Mac user sees; the only gain is shared code.
2. **Windows alpha reuses what exists**, so almost nothing is invented:
   - Electron shell loads the dashboard.
   - Dashboard allows `win32` (a small change in the dashboard repo).
   - The shell implements the bridge calls the web path already uses: `systemAudio.start/stop/onPcm/onLost`, `shell.setState`, `saas.request`, permissions, drafts.
   - Call audio comes from Chromium loopback in a hidden window, converted to 16 kHz PCM and sent to the dashboard.
   - The island is the React island fed by the `shell:state` the dashboard already sends. The TypeScript core port is not needed for this step.
3. **Measure on the AnyDesk PC** with a real Meet and a HubSpot call: audio quality, timing with the window behind the call, memory, CPU.
4. **Only if timing or capture fails**, build the native helper and move the socket and transcript into Electron main using the TypeScript core already written. Nothing built so far is wasted.
5. **If memory is the blocker on managed PCs**, build a minimal WebView2 host and compare on the same machine.

### Added 2026-10-05: running, updating, looks, weight, permissions

Documented in Electron 33.4.11's own type definitions:
- `systemPreferences.getMediaAccessStatus('microphone' | 'camera' | 'screen')` works on Windows and macOS. On Windows 10 and later it reflects the global setting that controls microphone and camera access for all desktop apps, and always returns granted for screen.
- `systemPreferences.askForMediaAccess` is macOS only. Windows has no per-app prompt.
- System-audio loopback (`audio: 'loopback'`) is, in this version, supported only on Windows. On the Mac, Electron cannot capture the call's audio alone, which is why a Swift helper would stay.
- Electron's built-in updater uses Squirrel on Windows.

Present in this repo: `electron-builder` 25.1.8 with NSIS, MSI and AppX targets. Not present: `electron-updater`, the usual updater that works with electron-builder.

Measured (`app/test/perf-dashboard.mjs`, dashboard login page, not a signed-in session): a dashboard window adds roughly 30 to 70 MB of renderer memory and gives it back when the window is closed (344 MB with it open, 275 MB after closing, harness windows included). The base of Browser, GPU and Utility processes is about 170 to 200 MB and does not shrink.

Levers that work: create the dashboard window on demand and destroy it when closed. Levers that did not: the four Chromium switches tested earlier. Not measured: a signed-in dashboard, and WebView2.
