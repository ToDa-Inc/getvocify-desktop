import Foundation
import VocifyCore

if ProcessInfo.processInfo.environment["VOCIFY_PERF"] != nil { measureLongCall() }

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

// Live transcript: same rules as the dashboard's meeting-transcript.ts.
var live = LiveTranscript()
live.apply(text: "hola", isFinal: true, channel: "rep", start: 1, end: 2)
live.apply(text: "buenas", isFinal: false, channel: "prospect", start: 2, end: nil)
check(live.rows().map { [$0.key, $0.text, $0.pending] } == [["u0", "hola", ""], ["u1", "", "buenas"]], "tail has its own bubble")
live.apply(text: "buenas tardes", isFinal: true, channel: "prospect", start: 2, end: 3)
check(live.rows().map { [$0.key, $0.text] } == [["u0", "hola"], ["u1", "buenas tardes"]], "final keeps the tail's bubble")

var late = LiveTranscript()
late.apply(text: "Which", isFinal: true, channel: "prospect", start: 10, end: 11)
late.apply(text: "is it", isFinal: false, channel: "prospect", start: 12, end: nil)
late.apply(text: "is it?", isFinal: true, channel: "prospect", start: 12, end: 13)
late.apply(text: "Yes.", isFinal: true, channel: "rep", start: 11, end: 12)
check(late.rows().map { [$0.key, $0.text] } == [["u0", "Which is it?"], ["u2", "Yes."]], "a late final never splits a bubble")

var echo = LiveTranscript()
echo.apply(text: "This was much better than the last one.", isFinal: true, channel: "prospect", start: 20, end: 22)
echo.apply(text: "much better than", isFinal: true, channel: "rep", start: 21, end: 21.6)
check(echo.rows().count == 1 && echo.rows()[0].speaker == .prospect, "mic echo of the call is hidden")

var restarted = LiveTranscript()
restarted.apply(text: "Hola", isFinal: true, channel: "rep", start: 1, end: 2)
restarted.apply(text: "Bon dia Jordi", isFinal: true, channel: "prospect", start: 2, end: 3)
restarted.apply(text: "Gracias per", isFinal: false, channel: "prospect", start: 4, end: nil)
check(restarted.reset(channel: "prospect", from: 0), "reset changes the side")
check(restarted.rows().map(\.text) == ["Hola"] && !restarted.reset(channel: "prospect", from: 0), "reset drops only that side")
let json = restarted.json()
check((json["segments"] as? [[String: Any]])?.first?["seen"] as? Int == 0, "json carries seen")
check(json["nextSeen"] as? Int == 3, "json carries the counter")
check(LiveTranscript.joinChunks("hola", ", qué tal") == "hola, qué tal", "chunks join")

// Where a call happens decides call vs meeting; unclear apps claim nothing.
check(CallSource.app(bundleID: "us.zoom.xos")?.kind == .meeting, "zoom is a meeting")
check(CallSource.app(bundleID: "com.microsoft.teams2")?.name == "Microsoft Teams", "new teams")
check(CallSource.app(bundleID: "net.whatsapp.WhatsApp")?.kind == .call, "whatsapp is a call")
check(CallSource.app(bundleID: "com.apple.FaceTime")?.kind == nil, "facetime claims nothing")
check(CallSource.app(bundleID: "com.google.Chrome") == nil, "browsers go by their page")
check(CallSource.page(in: ["https://mail.google.com/mail/u/0", "https://meet.google.com/abc-defg-hij"])?.name == "Google Meet", "meet tab")
check(CallSource.page("https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535")?.kind == .call, "hubspot calling window")
check(CallSource.page("https://app-eu1.hubspot.com/contacts/147506535/record/0-1/1") == nil, "a contact page is not a call")
check(CallSource.page("https://us02web.zoom.us/wc/123/join")?.kind == .meeting, "zoom web client")
check(CallSource.page("https://zoom.us/pricing") == nil, "zoom marketing site is not a meeting")
check(CallSource.page("http://meet.google.com/x") == nil, "https only")

// The mic hearing the call is hidden while still being written, not only once final.
var hearing = LiveTranscript()
hearing.apply(text: "departamentos de captación", isFinal: false, channel: "prospect", start: 40, end: nil)
hearing.apply(text: "departamentos de", isFinal: false, channel: "rep", start: 40.2, end: nil)
check(hearing.rows().map(\.speaker) == [.prospect], "an echo tail is not shown as the rep")
hearing.apply(text: "te paso la propuesta", isFinal: false, channel: "rep", start: 41, end: nil)
check(hearing.rows().map(\.speaker) == [.prospect, .rep], "the rep's own words still show")


// A short reaction said over someone keeps its bubble but doesn't cut their paragraph.
var talk = LiveTranscript()
talk.apply(text: "Lo que hacemos es escuchar la llamada", isFinal: true, channel: "rep", start: 10, end: 12)
talk.apply(text: "Vale.", isFinal: true, channel: "prospect", start: 11.5, end: 11.8)
talk.apply(text: "y proponer los cambios en el CRM.", isFinal: true, channel: "rep", start: 12.2, end: 14)
check(talk.rows().map(\.text) == ["Lo que hacemos es escuchar la llamada y proponer los cambios en el CRM.", "Vale."], "interjection keeps the paragraph whole")
// An answer after the speaker stopped is a turn.
var answer = LiveTranscript()
answer.apply(text: "¿Quedamos el martes?", isFinal: true, channel: "rep", start: 10, end: 11)
answer.apply(text: "Sí.", isFinal: true, channel: "prospect", start: 12.5, end: 12.8)
answer.apply(text: "Perfecto, te mando la invitación.", isFinal: true, channel: "rep", start: 13.5, end: 15)
check(answer.rows().count == 3, "an answer stays in order")

// Bubbles never swap: a tail settling after the other side's final keeps its place.
var overlap = LiveTranscript()
overlap.apply(text: "lo que te decía es que", isFinal: false, channel: "prospect", start: 20, end: nil)
overlap.apply(text: "Ajá, vale", isFinal: false, channel: "rep", start: 21, end: nil)
overlap.apply(text: "Ajá, vale.", isFinal: true, channel: "rep", start: 21, end: 21.5)
let before = overlap.rows().map(\.key)
overlap.apply(text: "lo que te decía es que funciona.", isFinal: true, channel: "prospect", start: 20, end: 23)
check(before == overlap.rows().map(\.key), "order is the same before and after the tail settles")
check(overlap.rows().map(\.speaker) == [.prospect, .rep], "the earlier speaker stays above")

// The words a final doesn't cover stay on screen in the same bubble.
var partial = LiveTranscript()
partial.apply(text: "hola qué tal estás", isFinal: false, channel: "rep", start: 1, end: 2.4)
partial.apply(text: "Hola, qué tal", isFinal: true, channel: "rep", start: 1, end: 2)
check(partial.rows().map { [$0.key, $0.text, $0.pending] } == [["u0", "Hola, qué tal", "estás"]], "the rest of the tail stays")
partial.apply(text: "estás?", isFinal: true, channel: "rep", start: 2, end: 2.5)
check(partial.rows().map { [$0.key, $0.text, $0.pending] } == [["u0", "Hola, qué tal estás?", ""]], "and settles in the same bubble")
check(LiveTranscript.remainder(of: "a b c", after: "a b c.") == nil, "nothing left, no tail")
// A final for the whole tail that drops a word (Deepgram) leaves nothing behind.
var revised = LiveTranscript()
revised.apply(text: "vale vale perfecto", isFinal: false, channel: "rep", start: 1, end: 2)
revised.apply(text: "Vale, perfecto.", isFinal: true, channel: "rep", start: 1, end: 2)
check(revised.rows().map { [$0.text, $0.pending] } == [["Vale, perfecto.", ""]], "no stale words")

// Who spoke: the name the call app showed for most of the sentence.
var shown = SpeakerTimeline()
shown.record(at: 0, speaking: ["Marta"])
shown.record(at: 4, speaking: ["Juan"])
shown.record(at: 6, speaking: [])
check(shown.name(from: 0.5, to: 3.5) == "Marta", "named by who was shown")
check(shown.name(from: 3.5, to: 5.8) == "Juan", "the one shown longest wins")
check(shown.name(from: 8, to: 9) == nil, "nobody shown, no name")

// Two people on the other side get their own paragraphs, under their names.
var guests = LiveTranscript()
guests.apply(text: "Hola, soy Marta.", isFinal: true, channel: "prospect", start: 1, end: 2, name: "Marta")
guests.apply(text: "Y yo Juan.", isFinal: true, channel: "prospect", start: 3, end: 4, name: "Juan")
guests.apply(text: "Encantado.", isFinal: true, channel: "rep", start: 5, end: 6)
check(guests.rows().map { $0.label ?? "" } == ["Marta", "Juan", "You"], "names on the other side")
check(guests.rows().count == 3, "a new person starts a paragraph")

check(ZoomTile.speakingName("Marta García, Computer audio, Active speaker") == "Marta García", "zoom tile name")
check(ZoomTile.speakingName("Juan, Computer audio") == nil, "not speaking, no name")
check(ZoomTile.speakingName("Ana Pérez, Active speaker") == "Ana Pérez", "no audio marker")

// Two people shown about as long: nobody is named rather than the wrong one.
var crosstalk = SpeakerTimeline()
crosstalk.record(at: 10, speaking: ["Marta"])
crosstalk.record(at: 10.5, speaking: ["Juan"])
crosstalk.record(at: 11, speaking: [])
check(crosstalk.name(from: 10.3, to: 10.7) == nil, "a close race names nobody")
check(crosstalk.name(from: 9.6, to: 10.4) == "Marta", "a clear lead still names")
var glimpse = SpeakerTimeline()
glimpse.record(at: 20, speaking: ["Marta"])
glimpse.record(at: 20.1, speaking: [])
check(glimpse.name(from: 20, to: 21) == nil, "a glimpse is not enough")

// Google Meet, read by the Chrome extension and passed on by the native host.
let meet = MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[" Marta García ","Juan","Juan"]}"#.utf8))
check(meet?.speaking == ["Juan", "Marta García"], "meet names trimmed, deduped, sorted")
check(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[]}"#.utf8))?.speaking == [], "nobody speaking")
check(MeetSpeaking.parse(Data(#"{"type":"other","speaking":["Marta"]}"#.utf8)) == nil, "other messages ignored")
check(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[3]}"#.utf8)) == nil, "names must be text")
check(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[""]}"#.utf8)) == nil, "no empty names")
check(MeetSpeaking.parse(Data(meet!.json().utf8)) == meet, "round trip")

var reader = NativeMessageReader()
let one = NativeMessageReader.frame(Data(#"{"a":1}"#.utf8))
let two = NativeMessageReader.frame(Data(#"{"b":2}"#.utf8))
let both = one + two
check(reader.append(both.prefix(6)) == [], "partial frame waits")
check(reader.append(both.dropFirst(6)) == [Data(#"{"a":1}"#.utf8), Data(#"{"b":2}"#.utf8)], "frames split and joined")
var oversized = NativeMessageReader()
check(oversized.append(Data([0xFF, 0xFF, 0xFF, 0x7F])) == nil, "oversized frame refused")

let hostManifest = try! JSONSerialization.jsonObject(
    with: NativeHost.manifest(path: "/Applications/Vocify.app/Contents/Helpers/VocifyMeetHost", extensionIDs: ["abcdefghijklmnopabcdefghijklmnop", "not-an-id"])
) as! [String: Any]
check(hostManifest["name"] as? String == "com.vocify.speakers", "host name")
check(hostManifest["type"] as? String == "stdio", "host type")
check(hostManifest["allowed_origins"] as? [String] == ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"], "only real extension ids")

// A long call: paragraphs set aside after a minute read exactly as if rebuilt every time.
var hour = LiveTranscript()
var expected: [String] = []
for i in 0..<300 {
    let channel = i % 2 == 0 ? "rep" : "prospect"
    let text = "frase número \(i) del cliente \(i % 7)"
    let start = Double(i) * 10
    hour.apply(text: text, isFinal: false, channel: channel, start: start, end: nil)
    hour.apply(text: text, isFinal: true, channel: channel, start: start, end: start + 3)
    expected.append(text)
}
let got = hour.rows().map(\.text)
if got != expected {
    print("rows", got.count, "expected", expected.count)
    if let i = zip(got, expected).enumerated().first(where: { $0.element.0 != $0.element.1 })?.offset { print("first diff at", i, "got:", got[i], "| expected:", expected[i]) }
}
check(got == expected, "frozen paragraphs keep their text and order")
check(Set(hour.rows().map(\.key)).count == 300, "keys stay unique")
hour.apply(text: "y una más", isFinal: true, channel: "prospect", start: 2995, end: 2996)
check(hour.rows().last?.text == "frase número 299 del cliente 5 y una más", "the newest paragraph still grows")

// Stop pauses first and finishes after a short grace, so a wrong stop is one click to undo.
let manual = StopGrace(byHangUp: false, wasPaused: false)
check(manual.onStop == [.pause], "stopping a live recording pauses it first")
check(manual.onResume == [.resume], "resume carries on recording")
check(manual.onFinish == [.stop], "a manual stop ends without a hang-up")
check(manual.title == "Recording stopped", "a manual stop says so")
let alreadyPaused = StopGrace(byHangUp: false, wasPaused: true)
check(alreadyPaused.onStop.isEmpty && alreadyPaused.onResume.isEmpty, "a paused recording stays paused on resume")
let hungUp = StopGrace(byHangUp: true, wasPaused: false)
check(hungUp.onFinish == [.callEnded, .stop], "a hang-up reports the call ended only once it finishes")
check(hungUp.title == "Call ended", "a hang-up says the call ended")
check(hungUp.onStop == [.pause] && hungUp.onResume == [.resume], "a hang-up waits for Resume like a manual stop, in case the call only dropped")

// Losing the call's audio opens the closed island once, the moment it happens.
check(LostAudio.opensIsland(was: false, now: true, recording: true, open: false), "lost while recording opens the island")
check(!LostAudio.opensIsland(was: true, now: true, recording: true, open: false), "only when it changes")
check(!LostAudio.opensIsland(was: false, now: true, recording: false, open: false), "only while recording")
check(!LostAudio.opensIsland(was: false, now: true, recording: true, open: true), "already open stays as is")

// The call-type chip and its list: Vocify's proposal is marked, the rep's pick is final.
let typeOptions = [TypeMenu.Option(key: "discovery", label: "Discovery"), TypeMenu.Option(key: "closing", label: "Demo y cierre")]
let proposedMenu = TypeMenu(options: typeOptions, selected: "discovery", proposed: true)
check(proposedMenu.title == "Discovery" && proposedMenu.sparkle, "a proposal shows its type with the sparkle")
check(proposedMenu.rows.first?.key == nil && proposedMenu.rows.first?.checked == true, "while Vocify proposes, 'Let Vocify decide' is ticked")
check(proposedMenu.rows.first(where: { $0.key == "discovery" })?.suggested == true, "the proposed type is marked in the list")
check(proposedMenu.rows.first(where: { $0.key == "discovery" })?.checked == false, "a proposal is not the rep's pick")
let pickedMenu = TypeMenu(options: typeOptions, selected: "closing", proposed: false)
check(pickedMenu.title == "Demo y cierre" && !pickedMenu.sparkle, "the rep's pick shows without the sparkle")
check(pickedMenu.rows.first(where: { $0.key == "closing" })?.checked == true && pickedMenu.rows.first?.checked == false, "the pick is ticked")
let emptyMenu = TypeMenu(options: typeOptions, selected: nil, proposed: false)
check(emptyMenu.title == "Call type" && emptyMenu.placeholder && !emptyMenu.sparkle, "nothing known yet reads Call type")

// The island's live help switch is for this call only.
check(LiveHelpSwitch.command(turningOn: false) == "assist-off" && LiveHelpSwitch.command(turningOn: true) == "assist-on", "switch commands")

// The voice wave's colour says who is talking; it never flickers between sides in silence or near ties.
check(WaveSide.next(you: 0.01, them: 0.02, previous: .you) == .you, "silence keeps the colour")
check(WaveSide.next(you: 0.5, them: 0.1, previous: .them) == .you, "the rep clearly louder turns it beige")
check(WaveSide.next(you: 0.1, them: 0.6, previous: .you) == .them, "them clearly louder turns it white")
check(WaveSide.next(you: 0.32, them: 0.30, previous: .them) == .them, "a near tie keeps the colour")

// Calling the CRM contact on screen (shell:state onScreen / dial, crm:screen).
var screen = CrmScreenChange()
check(screen.next(["a"]) == ["a"], "the first CRM page is sent")
check(screen.next(["a"]) == nil, "the same pages are not sent again")
check(screen.next([]) == [], "leaving the CRM record is sent once")
check(screen.next([]) == nil, "and only once")
check(CrmTabsAccess.aggregate(["denied", "granted"]) == "authorized", "one browser allowed is enough")
check(CrmTabsAccess.aggregate([]) == "unavailable", "no browser open")
check(CrmTabsAccess.aggregate(["not_asked", "denied"]) == "denied", "denied beats not asked")
check(CrmTabsAccess.aggregate(["not_asked", "unavailable"]) == "never_requested", "nobody answered yet")
// Same rule as the dashboard's formatCallerIdDisplay (src/lib/dial-target.ts).
check(PhoneFormat.grouped("+34600111222") == "+34 600 11 12 22", "Spanish number grouped like the dashboard")
check(PhoneFormat.grouped("+447700900123") == "+447700900123", "other countries as stored")
let ana = OnScreenCall.decode(["provider": "hubspot", "crmLabel": "HubSpot", "name": "Ana Ruiz", "phone": "+34600111222", "callerId": "+34910000000", "state": "callable"])
check(ana?.state == .callable && ana?.name == "Ana Ruiz", "decodes the callable contact")
check(OnScreenCall.decode(nil) == nil && OnScreenCall.decode(["state": "weird"]) == nil, "rejects anything else")

// What happened with the contact lately, under the offer: two lines at most, loading as one, anything else as none.
let briefBase: [String: Any] = ["provider": "hubspot", "crmLabel": "HubSpot", "name": "Ana Ruiz", "phone": "+34600111222", "callerId": "+34910000000", "state": "callable"]
let briefReady = OnScreenCall.decode(briefBase.merging(["brief": ["state": "ready", "lines": ["One.", " ", "Two.", "Three."]]]) { $1 })!
check(briefReady.brief == .ready(["One.", "Two."]) && briefReady.briefLines == 2, "the brief keeps two lines")
let briefLoading = OnScreenCall.decode(briefBase.merging(["brief": ["state": "loading"]]) { $1 })!
check(briefLoading.brief == .loading && briefLoading.briefLines == 1, "a loading brief takes one line")
check(OnScreenCall.decode(briefBase.merging(["brief": ["state": "ready", "lines": [String]()]]) { $1 })!.brief == nil, "an empty brief is none")
check(OnScreenCall.decode(briefBase.merging(["brief": "junk"]) { $1 })!.brief == nil && OnScreenCall.decode(briefBase)!.briefLines == 0, "no brief, no lines")
let anaConfirm = CallWording.confirm(ana!)
check(anaConfirm.title == "Ana Ruiz" && anaConfirm.line == "+34 600 11 12 22" && anaConfirm.button == "Call", "confirm row: who and their number")
check(CallWording.glyphHelp(ana!) == "Call Ana Ruiz", "glyph help")
let noPhone = OnScreenCall.decode(["provider": "hubspot", "crmLabel": "HubSpot", "name": "Ana Ruiz", "state": "no_phone"])!
check(CallWording.glyphHelp(noPhone) == "No phone in HubSpot" && CallWording.confirm(noPhone).button == nil, "no phone")
let noCaller = OnScreenCall.decode(["provider": "hubspot", "crmLabel": "HubSpot", "name": "Ana Ruiz", "phone": "+34600111222", "state": "no_caller_id"])!
check(CallWording.confirm(noCaller).line == "Add a caller ID to call" && CallWording.confirm(noCaller).button == "Add caller ID", "no caller id")
let several = OnScreenCall.decode(["provider": "hubspot", "crmLabel": "HubSpot", "state": "needs_contact"])!
check(CallWording.confirm(several).title == "HubSpot record with several contacts" && CallWording.confirm(several).line == "Open the contact to call", "several contacts")
let ringing = DialIslandState.decode(["phase": "ringing", "name": "Ana Ruiz", "phone": "+34600111222", "muted": false])
check(ringing?.phase == .ringing && CallWording.dialing(ringing!) == "Calling Ana Ruiz…", "dialing copy")
let nameless = DialIslandState.decode(["phase": "connecting", "phone": "+34600111222", "muted": false])!
check(CallWording.dialing(nameless) == "Calling +34 600 11 12 22…", "dialing a number")
let missed = DialIslandState.decode(["phase": "ended", "phone": "+34600111222", "muted": false, "message": "Busy"])!
check(CallWording.ended(missed) == "Busy", "the carrier's reason")
check(CallWording.ended(DialIslandState.decode(["phase": "ended", "phone": "+34600111222", "muted": false])!) == "Call ended", "no reason")
let liveDial = DialIslandState.decode(["phase": "active", "phone": "+34600111222", "muted": true, "answeredAt": 1_700_000_000_000.0])!
check(liveDial.muted && liveDial.answeredAt == Date(timeIntervalSince1970: 1_700_000_000), "answered at, from ms")
check(DialIslandState.decode(["phase": "active"]) == nil, "a dial needs its phone")
check(DialIslandState.isCallUp(liveDial) && !DialIslandState.isCallUp(missed), "an ended dial is not a call")

// The island's call offer follows the front window's active tab only (as the Chrome extension follows the focused tab).
let hubspotA = "https://app.hubspot.com/contacts/1/record/0-1/2"
let hubspotB = "https://app.hubspot.com/contacts/1/record/0-1/3"
check(CrmPages.frontRecordURLs(fromScriptOutput: "\(hubspotA)\n\(hubspotB)\n") == [hubspotA], "front window's tab only")
check(CrmPages.frontRecordURLs(fromScriptOutput: "https://mail.google.com/mail/u/0/\n\(hubspotB)\n").isEmpty, "a non-CRM front tab offers nobody, even with a CRM tab behind it")
check(CrmPages.frontRecordURLs(fromScriptOutput: "\n\(hubspotA)\n") == [hubspotA], "blank lines are skipped")
check(CrmPages.frontRecordURLs(fromScriptOutput: "").isEmpty, "no window")

// A meeting announced a minute before it starts (shell:state meeting, from the calendar).
let soon = IslandMeeting.decode([
    "id": "ev-1", "who": "Marta García", "title": "Demo Vocify", "startsAt": "2026-10-08T09:30:00+00:00",
    "url": "https://meet.google.com/abc-defg-hij", "platform": "meet",
    "brief": ["state": "ready", "lines": ["Asked for pricing for 12 seats."]],
])!
let startsAt = soon.startsAt
check(soon.who == "Marta García" && soon.url?.host == "meet.google.com" && soon.briefLines == 1, "meeting decodes")
check(MeetingWording.line(soon, now: startsAt.addingTimeInterval(-60)) == "Demo Vocify · in 1 min · Google Meet", "a minute before")
check(MeetingWording.when(startsAt, now: startsAt.addingTimeInterval(10)) == "now", "starting now")
check(MeetingWording.when(startsAt, now: startsAt.addingTimeInterval(190)) == "started 3 min ago", "already started")
check(IslandMeeting.decode(["id": "ev-2", "who": "Ana", "startsAt": "2026-10-08T09:30:00.123+00:00", "url": "javascript:alert(1)"])?.url == nil, "only web links open")
check(IslandMeeting.decode(["id": "ev-3", "who": " ", "startsAt": "2026-10-08T09:30:00Z"]) == nil, "needs who")
check(IslandMeeting.decode(["id": "ev-4", "who": "Ana", "startsAt": "tomorrow"]) == nil, "needs a start")

print("ok")
