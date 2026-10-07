// Temporary stand-in for the Mac helper's `geometry.get`: prints the built-in screen's notch as JSON.
// Run with `swift screen.swift`. Same measurements as IslandGeometry.measure in MeetingPill.swift.
import AppKit

let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
guard let screen else {
    print("{}")
    exit(0)
}
var result: [String: Any] = [
    "width": screen.frame.width,
    "height": screen.frame.height,
    "originX": screen.frame.minX,
    "originY": screen.frame.minY,
    "menuBar": screen.frame.maxY - screen.visibleFrame.maxY,
]
if screen.safeAreaInsets.top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
    result["notchWidth"] = screen.frame.width - left.width - right.width
    result["barHeight"] = screen.safeAreaInsets.top
    result["midX"] = (left.maxX + right.minX) / 2
}
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
