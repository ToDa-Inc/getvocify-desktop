# vocify-mac-helper protocol

The Electron app on macOS gets the things only native code can do from one small command-line program,
`vocify-mac-helper`, shipped inside the app (`Contents/Resources/mac-helper/vocify-mac-helper`) and started by the app,
so macOS attributes its permissions to Vocify (the responsible process). One process per command.
Each command stops on SIGTERM or when its stdin closes. macOS 14 or later (`mic` needs 14.2).

Status and events are one JSON object per line. Nothing else is written to the channel a command uses for them.

## `vocify-mac-helper audio`

The call's audio: everything the Mac plays, except the Vocify app (the helper's parent) and the helper itself, through
ScreenCaptureKit, the same capture and recovery as the Swift app's MeetingCapture (permission: Screen & System Audio
Recording).

- **stdout**: raw PCM, signed 16-bit little-endian, mono, 16 000 Hz, continuous, in chunks of any size. The app cuts it
  into 3200-byte (100 ms) frames. When nothing plays, silence is written, so the stream never stalls.
- **stderr**, JSON lines:
  - `{"event":"started"}` once capture runs.
  - `{"event":"error","reason":"<code>"}` then exit 1, when capture cannot start: `permission_denied` (Screen & System
    Audio Recording is off), `capture_failed`.
  - `{"event":"lost","reason":"<code>"}` then exit 0, when capture ends on its own and a restart did not bring it back.
- A change of audio output, or 10 s without samples, restarts the capture (at most once per 30 s unless forced).
- Exit 0 on SIGTERM or stdin closed.

## `vocify-mac-helper audio-permission`

- **stdout**: one line `{"status":"authorized"|"never_requested"}` then exit 0. Never shows a prompt
  (`CGPreflightScreenCaptureAccess`, as the Swift app). macOS does not tell a refusal from "never asked" here.

## `vocify-mac-helper mic`

Which apps are using a microphone (Core Audio `kAudioProcessPropertyIsRunningInput`, macOS 14.2+).

- **stdout**, JSON lines: `{"event":"mic","apps":[{"bundleId":"us.zoom.xos","name":"zoom.us","pid":123,"path":"/Applications/zoom.us.app"}]}`,
  once at start and again every time the set of apps changes. `apps` lists every app with a running input, Vocify's
  own included: the app decides what counts as a call. A browser's helper process is named as its browser (owning
  app), as `MicActivityMonitor.owningApp` does in the Swift app.
- Exit 0 on SIGTERM or stdin closed.

## `vocify-mac-helper speakers [--ask-accessibility]`

Who the meeting app shows speaking, while a call is recorded. Only display names, never audio.

- Zoom: the "Zoom Meeting" window read through Accessibility every 0.4 s (tiles described "Name, Computer audio,
  Active speaker"), as the Swift app's ActiveSpeakers. Needs Vocify allowed under Accessibility; `--ask-accessibility`
  shows macOS's prompt once. Without it, or outside a Zoom meeting, nothing is reported for Zoom.
- Google Meet: each reading the Vocify Chrome extension sends through native messaging (below), as it arrives.
- **stdout**, JSON lines: `{"event":"speaking","source":"zoom"|"meet","names":["Marta García"]}` (`[]`: nobody).
- Exit 0 on SIGTERM or stdin closed.

## Chrome native messaging host (`vocify-mac-helper chrome-extension://<id>/`)

Chrome starts the helper with the extension's origin as its first argument (host `com.vocify.speakers`, manifest written
by the app at launch). stdin: Chrome's framing (32-bit native-order length, then UTF-8 JSON), each message
`{"type":"meet-speakers","speaking":[...]}`. Each one is posted as the distributed notification
`com.vocify.meet-speakers` (object: the JSON), which `speakers` and the Swift app listen to. Nothing is written back.
Exits when Chrome closes stdin.

## `vocify-mac-helper screen`

- **stdout**: one line, the built-in screen as JSON, then exit 0. Same fields as `main/native/screen.swift`:
  `width`, `height`, `originX`, `originY`, `menuBar`, and on a screen with a notch `notchWidth`, `barHeight`, `midX`.
