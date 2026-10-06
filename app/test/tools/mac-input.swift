import CoreGraphics
import Foundation
// Real OS input: a left click at (x, y) in screen points, then each character of the text typed as key events.
let x = Double(CommandLine.arguments[1])!, y = Double(CommandLine.arguments[2])!
let text = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : ""
let p = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)
CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(150_000)
CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(60_000)
CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(400_000)
for ch in text.utf16 {
  var c = ch
  let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)!
  down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
  down.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)!
  up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
  up.post(tap: .cghidEventTap)
  usleep(25_000)
}
