import Foundation
import VocifyCore

/// Times a long call through the live transcript (run with VOCIFY_PERF=1).
func measureLongCall() {
    var live = LiveTranscript()
    let words = ["vale", "entonces", "el", "pipeline", "del", "cliente", "propuesta", "martes", "precio", "equipo"]
    let started = Date()
    var slowest = 0.0
    for i in 0..<4000 {
        let t = Double(i) * 0.9
        let channel = i % 3 == 0 ? "rep" : "prospect"
        let text = (0..<3).map { words[(i + $0 * 7) % words.count] }.joined(separator: " ")
        let one = Date()
        live.apply(text: text, isFinal: false, channel: channel, start: t, end: nil)
        live.apply(text: text, isFinal: true, channel: channel, start: t, end: t + 0.8)
        _ = live.rows()
        slowest = max(slowest, Date().timeIntervalSince(one))
    }
    print(String(format: "long call: 4000 finals in %.2fs, slowest update %.1f ms", Date().timeIntervalSince(started), slowest * 1000))
}
