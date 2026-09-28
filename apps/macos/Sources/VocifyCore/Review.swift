import Foundation

public enum ReviewGate {
    public static let processing: Set<String> = [
        "uploading", "transcribing", "extracting", "pending_transcript",
    ]

    public static func status(of memo: [String: Any]) -> String {
        String(describing: memo["status"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func isReady(_ status: String) -> Bool {
        status == "pending_review" || status == "approved"
    }

    public static func failed(_ status: String) -> Bool {
        status == "failed" || status == "rejected"
    }
}

struct ExtractionPayload: Encodable {
    var summary: String
    var nextSteps: [String]
}

public struct ApproveBody: Encodable {
    public var dealId: String?
    public var isNewDeal: Bool
    public var summary: String
    public var nextSteps: [String]
    public var contactId: String?
    public var companyId: String?
    public var skipDeal: Bool

    public init(
        dealId: String? = nil,
        isNewDeal: Bool = false,
        summary: String,
        nextSteps: [String],
        contactId: String? = nil,
        companyId: String? = nil,
        skipDeal: Bool = false
    ) {
        self.dealId = dealId
        self.isNewDeal = isNewDeal
        self.summary = summary
        self.nextSteps = nextSteps
        self.contactId = contactId
        self.companyId = companyId
        self.skipDeal = skipDeal
    }

    enum CodingKeys: String, CodingKey {
        case dealId = "deal_id"
        case isNewDeal = "is_new_deal"
        case extraction
        case contactId = "contact_id"
        case companyId = "company_id"
        case skipDeal = "skip_deal"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(dealId, forKey: .dealId)
        try c.encode(isNewDeal, forKey: .isNewDeal)
        try c.encode(ExtractionPayload(summary: summary, nextSteps: nextSteps), forKey: .extraction)
        try c.encodeIfPresent(contactId, forKey: .contactId)
        try c.encodeIfPresent(companyId, forKey: .companyId)
        try c.encode(skipDeal, forKey: .skipDeal)
    }
}
