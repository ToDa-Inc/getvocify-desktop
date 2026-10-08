import XCTest
@testable import VocifyMacHelperCore

// Same checks as the Swift app (apps/macos/Sources/VocifyCoreChecks/main.swift), so both apps name speakers alike.
final class SpeakersTests: XCTestCase {

    func testZoomTile() {
        XCTAssertEqual(ZoomTile.speakingName("Marta García, Computer audio, Active speaker"), "Marta García")
        XCTAssertNil(ZoomTile.speakingName("Juan, Computer audio"))
        XCTAssertEqual(ZoomTile.speakingName("Ana Pérez, Active speaker"), "Ana Pérez")
    }

    func testMeetSpeaking() {
        let meet = MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[" Marta García ","Juan","Juan"]}"#.utf8))
        XCTAssertEqual(meet?.speaking, ["Juan", "Marta García"])
        XCTAssertEqual(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[]}"#.utf8))?.speaking, [])
        XCTAssertNil(MeetSpeaking.parse(Data(#"{"type":"other","speaking":["Marta"]}"#.utf8)))
        XCTAssertNil(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[3]}"#.utf8)))
        XCTAssertNil(MeetSpeaking.parse(Data(#"{"type":"meet-speakers","speaking":[""]}"#.utf8)))
        XCTAssertEqual(MeetSpeaking.parse(Data(meet!.json().utf8)), meet)
    }

    func testNativeMessageFraming() {
        var reader = NativeMessageReader()
        let both = NativeMessageReader.frame(Data(#"{"a":1}"#.utf8)) + NativeMessageReader.frame(Data(#"{"b":2}"#.utf8))
        XCTAssertEqual(reader.append(both.prefix(6)), [])
        XCTAssertEqual(reader.append(both.dropFirst(6)), [Data(#"{"a":1}"#.utf8), Data(#"{"b":2}"#.utf8)])
        var oversized = NativeMessageReader()
        XCTAssertNil(oversized.append(Data([0xFF, 0xFF, 0xFF, 0x7F])))
    }
}
