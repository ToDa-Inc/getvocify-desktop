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

    // Set up signal handler for SIGTERM
    signal(SIGTERM, handleSignal)
    signal(SIGINT, handleSignal)

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
    let event: [String: String] = [
        "event": "error",
        "reason": "not_implemented"
    ]

    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys

    do {
        let data = try encoder.encode(event)
        if let json = String(data: data, encoding: .utf8) {
            fputs(json + "\n", stderr)
        }
    } catch {
        fputs("error encoding audio error: \(error)\n", stderr)
    }

    exit(1)
}

// MARK: - Audio Permission Command

func commandAudioPermission() {
    let status = AudioPermissionChecker.getPermissionStatus()
    let response = AudioPermissionResponse(status: status)

    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys

    do {
        let data = try encoder.encode(response)
        if let json = String(data: data, encoding: .utf8) {
            print(json)
        }
    } catch {
        fputs("error encoding audio permission: \(error)\n", stderr)
        exit(1)
    }
}
