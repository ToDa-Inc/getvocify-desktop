import Foundation

/// What Approve in the island's after-call card writes. The island never writes a change it
/// doesn't show: past `maxChanges`, approving is left to Vocify's review.
public struct IslandApproval {
    public static let maxChanges = 6

    /// Every proposed change's key, in the order the card lists them.
    public let changes: [String]
    public let kept: Set<String>

    public init(changes: [String], kept: Set<String>) {
        self.changes = changes
        self.kept = kept
    }

    public var fits: Bool { changes.count <= Self.maxChanges }
    public var count: Int { changes.filter(kept.contains).count }
    public var omit: [String] { changes.filter { !kept.contains($0) } }
    public var canApprove: Bool { fits && count > 0 }
}
