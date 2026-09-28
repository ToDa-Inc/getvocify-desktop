import Foundation

public enum ChannelAudio {
    public static func frame(channel: String, pcm: Data) -> String {
        let payload: [String: String] = [
            "type": "AddChannelAudio",
            "channel": channel,
            "data": pcm.base64EncodedString(),
        ]
        let data = try? JSONSerialization.data(withJSONObject: payload)
        return String(data: data ?? Data(), encoding: .utf8) ?? ""
    }

    public static func transcriptText(from event: [String: Any]) -> (text: String, isFinal: Bool)? {
        guard (event["type"] as? String) == "Results" else { return nil }
        let channel = event["channel"] as? [String: Any]
        let alternatives = channel?["alternatives"] as? [[String: Any]]
        let text = (alternatives?.first?["transcript"] as? String) ?? ""
        let isFinal = (event["is_final"] as? Bool) == true || (event["speech_final"] as? Bool) == true
        return (text, isFinal)
    }
}
