import Foundation

/// Only the rep's mic still reaches Vocify. The rep is looking at the call, not the island,
/// so a closed island opens once to say so; after that it's theirs to close.
public enum LostAudio {
    public static func opensIsland(was: Bool, now: Bool, recording: Bool, open: Bool) -> Bool {
        !was && now && recording && !open
    }
}
