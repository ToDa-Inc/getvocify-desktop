import Foundation

/// The connected CRM as the island words it: its name when the dashboard has said which,
/// "the CRM" until then. Never a guessed provider.
public struct CrmName {
    public let name: String?

    public init(_ name: String?) {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.name = trimmed?.isEmpty == false ? trimmed : nil
    }

    /// In a sentence: "Updating Ana in Pipedrive…", "3 fields updated in the CRM".
    public var sentence: String { name ?? "the CRM" }
    /// On a button: "Add to HubSpot", "Add to CRM".
    public var short: String { name ?? "CRM" }
}

/// Only the rep's mic still reaches Vocify. The rep is looking at the call, not the island,
/// so a closed island opens once to say so; after that it's theirs to close.
public enum LostAudio {
    public static func opensIsland(was: Bool, now: Bool, recording: Bool, open: Bool) -> Bool {
        !was && now && recording && !open
    }
}
