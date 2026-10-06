import Foundation

/// Stopping a recording: it pauses at once and only ends once `seconds` pass without Resume
/// (or Finish), so a misclick or a call app dropping the mic is one click to undo, not a split memo.
public struct StopGrace: Equatable {
    public enum Step: Equatable { case pause, resume, stop, callEnded }

    public static let seconds: TimeInterval = 5

    /// The call app hung up (it let go of the mic), rather than the rep pressing Stop.
    public let byHangUp: Bool
    /// Already paused when Stop came: Resume leaves it paused.
    public let wasPaused: Bool

    public init(byHangUp: Bool, wasPaused: Bool) {
        self.byHangUp = byHangUp
        self.wasPaused = wasPaused
    }

    public var onStop: [Step] { wasPaused ? [] : [.pause] }
    public var onResume: [Step] { wasPaused ? [] : [.resume] }
    public var onFinish: [Step] { byHangUp ? [.callEnded, .stop] : [.stop] }
    public var title: String { byHangUp ? "Call ended" : "Recording stopped" }
}
