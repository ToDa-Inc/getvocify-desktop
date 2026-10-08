import Foundation
import VocifyMacHelperCore
import Darwin

// MARK: - Global state
var isRunning = true

// MARK: - Signal handler
func handleSignal(_ sig: Int32) {
    isRunning = false
}

// MARK: - Command Dispatch

let arguments = CommandLine.arguments

// Chrome starts the helper as the Vocify extension's native messaging host: its first argument is the
// extension's origin (chrome-extension://<id>/).
if arguments.count >= 2, arguments[1].hasPrefix("chrome-extension://") {
    commandMeetHost()
    exit(0)
}

guard arguments.count >= 2 else {
    fputs("usage: vocify-mac-helper <command>\n", stderr)
    fputs("commands: screen, mic, audio, audio-permission, speakers\n", stderr)
    exit(1)
}

let command = arguments[1]

switch command {
case "speakers":
    commandSpeakers(askAccessibility: arguments.contains("--ask-accessibility"))
case "screen":
    commandScreen()
case "mic":
    commandMic()
case "audio":
    commandAudio()
case "audio-permission":
    commandAudioPermission()
default:
    fputs("unknown command: \(command)\n", stderr)
    exit(1)
}

// MARK: - Screen Command

func commandScreen() {
    let screen = ScreenInfo.getBuiltInScreen()

    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys

    do {
        let data = try encoder.encode(screen)
        if let json = String(data: data, encoding: .utf8) {
            print(json)
        }
    } catch {
        fputs("error encoding screen info: \(error)\n", stderr)
        exit(1)
    }
}

// MARK: - Mic Command

func commandMic() {
    let monitor = MicMonitor()
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys

    signal(SIGTERM, handleSignal)
    signal(SIGINT, handleSignal)
    signal(SIGPIPE, SIG_IGN)
    stopWhenStdinCloses()

    monitor.start { apps in
        let event = MicEvent(apps: apps)
        do {
            let data = try encoder.encode(event)
            if let json = String(data: data, encoding: .utf8) {
                print(json)
                fflush(stdout)
            }
        } catch {
            fputs("error encoding mic event: \(error)\n", stderr)
        }
    }

    // Keep running using RunLoop until signal is received
    let runLoop = RunLoop.current
    while isRunning {
        runLoop.run(until: Date(timeIntervalSinceNow: 0.1))
    }

    monitor.stop()
}

// MARK: - Audio Command

func commandAudio() {
    signal(SIGTERM, handleSignal)
    signal(SIGINT, handleSignal)
    // Writing to the app after it went away must end the helper, not kill it with SIGPIPE mid-write.
    signal(SIGPIPE, SIG_IGN)
    stopWhenStdinCloses()
    let capture = SystemAudioCapture()
    var ended: (event: String, reason: String)?
    capture.onEnd = { event, reason in
        DispatchQueue.main.async {
            ended = (event, reason)
            isRunning = false
        }
    }
    capture.start()
    let runLoop = RunLoop.current
    while isRunning {
        runLoop.run(until: Date(timeIntervalSinceNow: 0.1))
    }
    capture.stop()
    if let ended {
        status(["event": ended.event, "reason": ended.reason])
        exit(ended.event == "error" ? 1 : 0)
    }
    exit(0)
}

/// PROTOCOL.md: a command also stops when its stdin closes, so a helper never outlives the app that started it.
func stopWhenStdinCloses() {
    Thread.detachNewThread {
        while FileHandle.standardInput.availableData.count > 0 {}
        DispatchQueue.main.async { isRunning = false }
    }
}

// MARK: - Audio Permission Command

func commandAudioPermission() {
    print("{\"status\":\"\(systemAudioPermission())\"}")
}


// MARK: - Speakers Command

/// Who the meeting app shows speaking, while a call is recorded (see PROTOCOL.md).
func commandSpeakers(askAccessibility: Bool) {
    signal(SIGTERM, handleSignal)
    signal(SIGINT, handleSignal)
    signal(SIGPIPE, SIG_IGN)
    stopWhenStdinCloses()
    if askAccessibility { _ = ZoomSpeakers.ensureTrusted(prompt: true) }

    func emit(_ source: String, _ names: [String]) {
        let event: [String: Any] = ["event": "speaking", "source": source, "names": names]
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }

    let center = DistributedNotificationCenter.default()
    let observer = center.addObserver(forName: Notification.Name(MeetSpeaking.notification), object: nil, queue: .main) { note in
        guard let text = note.object as? String, let meet = MeetSpeaking.parse(Data(text.utf8)) else { return }
        emit("meet", meet.speaking)
    }
    var zoomReadAt = Date.distantPast
    let runLoop = RunLoop.current
    while isRunning {
        runLoop.run(until: Date(timeIntervalSinceNow: 0.1))
        guard Date().timeIntervalSince(zoomReadAt) >= 0.4 else { continue }
        zoomReadAt = Date()
        if let names = ZoomSpeakers.read() { emit("zoom", names) }
    }
    center.removeObserver(observer)
}

// MARK: - Chrome native messaging host

/// Each message from the Vocify extension says who Google Meet shows speaking; it is passed on as a distributed
/// notification, which `speakers` (and the Swift app) listen to. Chrome stops the host by closing stdin.
func commandMeetHost() {
    var reader = NativeMessageReader()
    let input = FileHandle.standardInput
    let center = DistributedNotificationCenter.default()
    while true {
        let data = input.availableData
        guard !data.isEmpty, let messages = reader.append(data) else { return }
        for message in messages {
            guard let speaking = MeetSpeaking.parse(message) else { continue }
            center.postNotificationName(
                Notification.Name(MeetSpeaking.notification), object: speaking.json(), userInfo: nil, deliverImmediately: true
            )
        }
    }
}
