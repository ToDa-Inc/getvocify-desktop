import Foundation

/// Whose voice the island's wave shows. It changes only when a side is clearly speaking and
/// clearly louder; in silence or a near tie it keeps its colour, so it never flickers.
public enum WaveSide: Equatable {
    case you, them

    static let speaking = 0.05
    static let margin = 0.1

    public static func next(you: Double, them: Double, previous: WaveSide) -> WaveSide {
        guard max(you, them) >= speaking, abs(you - them) >= margin else { return previous }
        return you > them ? .you : .them
    }
}
