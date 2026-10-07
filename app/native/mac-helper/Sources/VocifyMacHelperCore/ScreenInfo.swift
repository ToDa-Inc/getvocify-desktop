import AppKit
import Foundation

/// Screen geometry information
public struct ScreenInfo: Codable {
    public let width: Double
    public let height: Double
    public let originX: Double
    public let originY: Double
    public let menuBar: Double

    // Notch information (optional, only on screens with notch)
    public let notchWidth: Double?
    public let barHeight: Double?
    public let midX: Double?

    enum CodingKeys: String, CodingKey {
        case width
        case height
        case originX
        case originY
        case menuBar
        case notchWidth
        case barHeight
        case midX
    }

    /// Get screen info for the built-in screen
    public static func getBuiltInScreen() -> ScreenInfo {
        // Prefer the screen with a notch (Dynamic Island)
        let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first

        guard let screen = screen else {
            return ScreenInfo(width: 0, height: 0, originX: 0, originY: 0, menuBar: 0, notchWidth: nil, barHeight: nil, midX: nil)
        }

        var notchWidth: Double? = nil
        var barHeight: Double? = nil
        var midX: Double? = nil

        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea,
           let right = screen.auxiliaryTopRightArea {
            notchWidth = Double(screen.frame.width) - Double(left.width) - Double(right.width)
            barHeight = Double(screen.safeAreaInsets.top)
            midX = Double(left.maxX + right.minX) / 2.0
        }

        let menuBarHeight = screen.frame.maxY - screen.visibleFrame.maxY

        return ScreenInfo(
            width: screen.frame.width,
            height: screen.frame.height,
            originX: screen.frame.minX,
            originY: screen.frame.minY,
            menuBar: menuBarHeight,
            notchWidth: notchWidth,
            barHeight: barHeight,
            midX: midX
        )
    }
}
