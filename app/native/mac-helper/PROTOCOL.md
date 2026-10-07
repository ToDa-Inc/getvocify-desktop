# vocify-mac-helper protocol

The Electron app on macOS gets the things only native code can do from one small command-line program,
`vocify-mac-helper`, shipped inside the app (`Contents/Resources/mac-helper/vocify-mac-helper`) and started by the app,
so macOS attributes its permissions to Vocify (the responsible process). One process per command.
Each command stops on SIGTERM or when its stdin closes. macOS 14.2 or later.

Status and events are one JSON object per line. Nothing else is written to the channel a command uses for them.

## `vocify-mac-helper audio`

The call's audio: everything the Mac plays, except the Vocify app's own processes (the helper's parent and its
children), through a Core Audio process tap.

- **stdout**: raw PCM, signed 16-bit little-endian, mono, 16 000 Hz, continuous, in chunks of any size. The app cuts it
  into 3200-byte (100 ms) frames.
- **stderr**, JSON lines:
  - `{"event":"started"}` once audio is flowing (silence counts: a quiet Mac still sends zeros).
  - `{"event":"error","reason":"<code>"}` then exit 1, when capture cannot start. Codes: `permission_denied`,
    `unsupported_os`, `tap_failed`.
  - `{"event":"lost","reason":"<code>"}` then exit 0, when capture ends on its own (for example `device_changed` that
    could not be recovered).
- Exit 0 on SIGTERM or stdin closed.

## `vocify-mac-helper audio-permission`

- **stdout**: one line `{"status":"authorized"|"denied"|"never_requested"}` then exit 0. Never shows a prompt.
  (If macOS offers no way to read this without asking, print `{"status":"unknown"}` and say so in the helper's README.)

## `vocify-mac-helper mic`

Which apps are using a microphone (Core Audio `kAudioProcessPropertyIsRunningInput`, macOS 14.2+).

- **stdout**, JSON lines: `{"event":"mic","apps":[{"bundleId":"us.zoom.xos","name":"zoom.us","pid":123,"path":"/Applications/zoom.us.app"}]}`,
  once at start and again every time the set of apps changes. `apps` lists every app with a running input, Vocify's
  own included: the app decides what counts as a call. A browser's helper process is named as its browser (owning
  app), as `MicActivityMonitor.owningApp` does in the Swift app.
- Exit 0 on SIGTERM or stdin closed.

## `vocify-mac-helper screen`

- **stdout**: one line, the built-in screen as JSON, then exit 0. Same fields as `main/native/screen.swift`:
  `width`, `height`, `originX`, `originY`, `menuBar`, and on a screen with a notch `notchWidth`, `barHeight`, `midX`.
