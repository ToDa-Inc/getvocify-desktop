import Foundation

/// The CRM pages in the frontmost browser, sent to the dashboard (`crm:screen`) only when they change.
public struct CrmScreenChange: Sendable {
    private var last: [String]?

    public init() {}

    /// The pages to send, or nil when they are the ones already sent.
    public mutating func next(_ urls: [String]) -> [String]? {
        guard urls != last else { return nil }
        last = urls
        return urls
    }
}

/// One answer for "may Vocify read the CRM tab", from each running browser's Automation consent.
public enum CrmTabsAccess {
    /// `CrmPageReader.Access` values in; the dashboard's permission vocabulary out.
    public static func aggregate(_ perBrowser: [String]) -> String {
        if perBrowser.contains("granted") || perBrowser.contains("authorized") { return "authorized" }
        if perBrowser.contains("denied") { return "denied" }
        if perBrowser.contains("not_asked") { return "never_requested" }
        return "unavailable"
    }
}
