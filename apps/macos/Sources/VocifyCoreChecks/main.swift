import Foundation
import VocifyCore

func check(_ condition: Bool, _ message: String) {
    if !condition {
        fputs("FAIL \(message)\n", stderr)
        exit(1)
    }
}

let url = LiveURL.transcription(apiBase: "https://api.getvocify.com/api/v1/")
check(url?.scheme == "wss", "scheme")
check(url?.absoluteString.contains("mode=copilot_channels") == true, "mode")
check(url?.absoluteString.contains("channel_labels=prospect,rep") == true, "labels")

let frame = ChannelAudio.frame(channel: "rep", pcm: Data([1, 2]))
check(frame.contains("AddChannelAudio"), "frame type")
check(frame.contains("\"channel\":\"rep\""), "frame channel")

let event: [String: Any] = [
    "type": "Results",
    "is_final": true,
    "channel": ["alternatives": [["transcript": "hola"]]],
]
let parsed = ChannelAudio.transcriptText(from: event)
check(parsed?.text == "hola", "transcript")
check(parsed?.isFinal == true, "final")

var line = AssistLine(helpOn: true)
line = line.present("Di esto ahora", evidenceCount: 1, playbookReady: true, now: Date(timeIntervalSince1970: 0))
check(line.visible(now: Date(timeIntervalSince1970: 1), speakerIsRep: false) == "Di esto ahora", "visible")
check(line.visible(now: Date(timeIntervalSince1970: 1), speakerIsRep: true) == nil, "rep hidden")
check(line.visible(now: Date(timeIntervalSince1970: 11), speakerIsRep: false) == nil, "expired")

let silent = AssistLine(helpOn: true).present("Di esto", evidenceCount: 0, playbookReady: true, now: Date())
check(silent.visible(now: Date(), speakerIsRep: false) == nil, "no evidence")

var note = LiveNote()
note.apply(text: "hola", isFinal: false, speaker: "prospect")
note.apply(text: "hola mundo", isFinal: true, speaker: "prospect")
note.apply(text: "otra", isFinal: true, speaker: "prospect")
check(note.turns.count == 1, "same speaker stays one paragraph")
check(note.turns[0].text == "hola mundo otra", "chunks join")
note.apply(text: "sí", isFinal: true, speaker: "rep")
check(note.turns.count == 2, "speaker change opens a paragraph")

var chunks = LiveNote()
for word in ["hola", "qué", "tal"] {
    chunks.apply(text: word, isFinal: true, speaker: "")
}
check(chunks.turns.count == 1, "short finals stay one paragraph")
check(chunks.turns[0].text == "hola qué tal", "short finals join")

let tails = PhraseFit.candidates("Perfecto, tío. Pues os paso esto.")
check(tails.first == "Perfecto, tío. Pues os paso esto.", "whole phrase first")
check(tails.dropFirst().first == "Pues os paso esto.", "then the last sentence")
check(tails.last == "…esto.", "then whole words only")
check(tails.allSatisfy { !$0.hasPrefix("…") || !$0.dropFirst().hasPrefix(" ") }, "no dangling space")
check(PhraseFit.candidates("   ").isEmpty, "empty")

// CRM pages: only HubSpot/Pipedrive app URLs leave the machine.
check(CrmPages.isCrmURL("https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968"), "hubspot eu record")
check(CrmPages.isCrmURL("https://app.hubspot.com/contacts/1/objects/0-1/views/all/list"), "hubspot list")
check(CrmPages.isCrmURL("https://acme.pipedrive.com/person/42"), "pipedrive person")
check(!CrmPages.isCrmURL("https://www.hubspot.com/pricing"), "hubspot marketing site")
check(!CrmPages.isCrmURL("https://knowledge.hubspot.com/a"), "hubspot docs")
check(!CrmPages.isCrmURL("https://evil.app.hubspot.com.example.com/x"), "lookalike host")
check(!CrmPages.isCrmURL("https://api.pipedrive.com/v1/persons/1"), "pipedrive api")
check(!CrmPages.isCrmURL("http://app.hubspot.com/contacts/1/record/0-1/2"), "plain http")
check(!CrmPages.isCrmURL("https://mail.google.com/mail/u/0"), "other sites stay local")

let output = """
https://mail.google.com/mail/u/0/#inbox
https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535
  https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968
missing value

"""
check(CrmPages.crmURLs(fromScriptOutput: output) == [
    "https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535",
    "https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968",
], "script output keeps CRM URLs in window order")

let order = CrmPages.browsersToRead(
    running: ["com.apple.finder", "com.apple.Safari", "com.google.Chrome", "com.example.Other"],
    frontmost: "com.google.Chrome"
).map(\.bundleID)
check(order == ["com.google.Chrome", "com.apple.Safari"], "front-most browser first, unsupported apps skipped")
check(CrmPages.browsersToRead(running: [], frontmost: "com.google.Chrome").isEmpty, "nothing running, nothing read")
check(CrmPages.browser(bundleID: "com.apple.Safari")?.script.contains("current tab") == true, "safari tab term")
check(CrmPages.browser(bundleID: "com.google.Chrome")?.script.contains("tell application id \"com.google.Chrome\"") == true, "addressed by bundle id")

print("ok")
