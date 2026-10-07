# vocify-mac-helper

A small command-line utility for the Vocify Electron app on macOS that provides native capabilities:
- **screen**: Get display geometry and notch information
- **mic**: Monitor which applications are using the microphone
- **audio**: Capture system audio (not yet implemented)
- **audio-permission**: Check system audio recording permission status

## Building

Build a universal (arm64 + x86_64) release binary:

```bash
./build.sh
```

The binary is written to `dist/vocify-mac-helper`.

### Requirements
- Swift 5.9+
- macOS 14 deployment target
- Xcode Command Line Tools

### Manual Build
For single-architecture debug builds:
```bash
swift build
# Output: .build/debug/vocify-mac-helper
```

## Commands

### screen
Print the built-in screen's geometry as JSON and exit.

```bash
vocify-mac-helper screen
```

Output:
```json
{"height":1440,"menuBar":25,"originX":0,"originY":0,"width":3440,"notchWidth":656,"barHeight":30,"midX":1720}
```

Fields:
- `width`, `height`: Screen dimensions in points
- `originX`, `originY`: Screen position
- `menuBar`: Menu bar height
- `notchWidth`, `barHeight`, `midX` (optional): Dynamic Island dimensions

### mic
Report which apps are using the microphone, updating whenever it changes. Exits on SIGTERM or stdin close.

```bash
vocify-mac-helper mic
```

Outputs JSON lines:
```json
{"event":"mic","apps":[]}
{"event":"mic","apps":[{"bundleId":"us.zoom.xos","name":"zoom.us","pid":123,"path":"/Applications/zoom.us.app"}]}
```

Permissions required (in host app's Info.plist):
- `NSMicrophoneUsageDescription`: "We need microphone access to detect when you're on a call"

API used:
- macOS 14.2+: `kAudioHardwarePropertyProcessObjectList` for per-process input state
- Core Audio property listeners for change detection
- Fallback polling every 1 second for non-default input devices

### audio
Capture system audio through a Core Audio process tap (macOS 14.2+).

Currently returns an error; full implementation pending.

Permissions required (in host app's Info.plist):
- `NSAudioCaptureUsageDescription`: "We need to record system audio during calls"
- Note: System audio recording may also require Screen Recording permission (handled by Core Audio tap)

### audio-permission
Check system audio recording permission status without prompting.

```bash
vocify-mac-helper audio-permission
```

Output:
```json
{"status":"unknown"}
```

Status values:
- `authorized`: User granted permission
- `denied`: User denied permission
- `never_requested`: Permission has not been requested
- `unknown`: macOS offers no public API to read this state (current implementation)

## Testing

Run unit tests:
```bash
swift test
```

Test individual commands (no permission prompts):
```bash
# Safe to run
.build/debug/vocify-mac-helper screen
.build/debug/vocify-mac-helper mic

# Do NOT run (requires audio permission):
# .build/debug/vocify-mac-helper audio
```

## Implementation Notes

### Pure Logic vs Native Glue
- `Sources/VocifyMacHelperCore/`: Pure Swift logic (audio processing, app registry, JSON models) with unit tests
- `Sources/VocifyMacHelper/main.swift`: Command dispatch and Core Audio glue only
- Tests cover audio resampling, app bundle matching, and JSON serialization

### Microphone Monitoring
Uses Core Audio's per-process input state (`kAudioHardwarePropertyProcessObjectList`). Reports all apps with running input; the Electron side filters call apps. Property listeners trigger immediately; fallback polling every 1 second ensures compatibility with non-default input devices.

### Audio Capture
**Not yet implemented.** Full implementation requires:
- Core Audio process tap setup (`AudioHardwareCreateProcessTap` on macOS 14.2+)
- Excluding helper's own process and children
- Handling sample format conversion to mono 16 kHz s16le
- Binary PCM streaming to stdout
- Recovery from device changes

See `PROTOCOL.md` for output specification.

### Audio Permission
macOS provides no public API to query system audio recording (process tap) permission status without prompting. The permission gate is in System Preferences > Privacy & Security > Screen Recording, but this state cannot be read via public frameworks.

## Files

- `Package.swift`: Swift package manifest
- `Sources/VocifyMacHelperCore/`: Core library (audio processing, app info, screen geometry, mic monitoring)
- `Sources/VocifyMacHelper/main.swift`: Command dispatcher and entry point
- `Tests/`: Unit tests for core logic
- `build.sh`: Universal binary build script
- `PROTOCOL.md`: JSON protocol specification
- `.gitignore`: Ignore build artifacts
