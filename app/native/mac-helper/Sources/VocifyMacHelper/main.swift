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

guard arguments.count >= 2 else {
    fputs("usage: vocify-mac-helper <command>\n", stderr)
    fputs("commands: screen, mic, audio, audio-permission\n", stderr)
    exit(1)
}

let command = arguments[1]

switch command {
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
