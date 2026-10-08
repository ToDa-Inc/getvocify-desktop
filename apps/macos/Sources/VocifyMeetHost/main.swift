import Foundation
import VocifyCore

// Chrome starts this when the Vocify extension connects (Chrome native messaging) and stops it
// when the extension disconnects. Each message says who Google Meet shows speaking; it is passed
// to the Vocify app, which may or may not be recording. Nothing is written back to Chrome.

var reader = NativeMessageReader()
let input = FileHandle.standardInput
let center = DistributedNotificationCenter.default()

while true {
    let data = input.availableData
    guard !data.isEmpty, let messages = reader.append(data) else { exit(0) }
    for message in messages {
        guard let speaking = MeetSpeaking.parse(message) else { continue }
        center.postNotificationName(
            Notification.Name(MeetSpeaking.notification),
            object: speaking.json(),
            userInfo: nil,
            deliverImmediately: true
        )
    }
}
