import Foundation

/// Audio permission status
public enum AudioPermissionStatus: String, Codable {
    case authorized
    case denied
    case neverRequested = "never_requested"
    case unknown
}

/// Pure-logic audio permission checking
public struct AudioPermissionChecker {
    /// Get the system audio recording permission status
    /// Without prompting the user, returns the current status.
    /// Note: There is no supported public API in macOS to read the system audio recording
    /// permission status without prompting. This implementation returns "unknown" as per
    /// the protocol specification.
    public static func getPermissionStatus() -> AudioPermissionStatus {
        // macOS does not provide a public API to check system audio recording (process tap)
        // permission status without prompting. The permission is managed through:
        // - System Preferences > Privacy & Security > Screen Recording
        // But there's no public API to query this state.
        return .unknown
    }
}

public struct AudioPermissionResponse: Codable {
    public let status: String

    public init(status: AudioPermissionStatus) {
        self.status = status.rawValue
    }
}
