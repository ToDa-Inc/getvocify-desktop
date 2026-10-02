import Foundation

/// The call-type chip and its list in the island. Vocify's proposal shows with a sparkle and is
/// marked in the list; the rep's pick shows plain and is final. "Let Vocify decide" hands it back.
public struct TypeMenu {
    public struct Option: Equatable {
        public let key: String
        public let label: String
        public init(key: String, label: String) { self.key = key; self.label = label }
    }

    public struct Row: Equatable {
        /// nil: "Let Vocify decide".
        public let key: String?
        public let label: String
        public let checked: Bool
        /// Vocify's current proposal.
        public let suggested: Bool
    }

    public static let decideLabel = "Let Vocify decide"
    public static let placeholderTitle = "Call type"

    public let options: [Option]
    public let selected: String?
    public let proposed: Bool

    public init(options: [Option], selected: String?, proposed: Bool) {
        self.options = options
        self.selected = selected
        self.proposed = proposed
    }

    private var picked: String? { proposed ? nil : selected }
    private var label: String? { options.first { $0.key == selected }?.label }

    public var title: String { label ?? Self.placeholderTitle }
    public var sparkle: Bool { proposed && label != nil }
    public var placeholder: Bool { label == nil }

    public var rows: [Row] {
        [Row(key: nil, label: Self.decideLabel, checked: picked == nil, suggested: false)]
            + options.map { option in
                Row(
                    key: option.key,
                    label: option.label,
                    checked: option.key == picked,
                    suggested: proposed && option.key == selected
                )
            }
    }
}

/// The island's live help switch: this call only; the remembered setting lives in Vocify.
public enum LiveHelpSwitch {
    public static func command(turningOn: Bool) -> String { turningOn ? "assist-on" : "assist-off" }
}
