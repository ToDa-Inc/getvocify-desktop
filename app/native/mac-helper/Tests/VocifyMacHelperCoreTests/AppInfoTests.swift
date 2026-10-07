import XCTest
@testable import VocifyMacHelperCore

final class AppInfoTests: XCTestCase {

    func testIsCallApp_KnownApps() {
        XCTAssertTrue(AppRegistry.isCallApp("us.zoom.xos"))
        XCTAssertTrue(AppRegistry.isCallApp("com.microsoft.teams2"))
        XCTAssertTrue(AppRegistry.isCallApp("com.tinyspeck.slackmacgap"))
        XCTAssertTrue(AppRegistry.isCallApp("com.google.Chrome"))
    }

    func testIsCallApp_Helpers() {
        // Browser helpers should match their parent bundle
        XCTAssertTrue(AppRegistry.isCallApp("com.google.Chrome.helper"))
        XCTAssertTrue(AppRegistry.isCallApp("org.mozilla.firefox.helper"))
    }

    func testIsCallApp_Unknown() {
        XCTAssertFalse(AppRegistry.isCallApp("com.example.unknown"))
        XCTAssertFalse(AppRegistry.isCallApp("com.spotify.client"))
    }

    func testDisplayName_Zoom() {
        let name = AppRegistry.displayName(bundleId: "us.zoom.xos", runningApp: nil)
        XCTAssertEqual(name, "Zoom")
    }

    func testDisplayName_Bundle() {
        let name = AppRegistry.displayName(bundleId: "com.microsoft.teams2", runningApp: nil)
        XCTAssertEqual(name, "com.microsoft.teams2")
    }
}

final class AppInfoCodingTests: XCTestCase {

    func testAppInfoEncoding() throws {
        let app = AppInfo(
            bundleId: "com.google.Chrome",
            name: "Google Chrome",
            pid: 1234,
            path: "/Applications/Google Chrome.app"
        )

        let encoded = try JSONEncoder().encode(app)
        let decoded = try JSONDecoder().decode(AppInfo.self, from: encoded)

        XCTAssertEqual(decoded.bundleId, "com.google.Chrome")
        XCTAssertEqual(decoded.name, "Google Chrome")
        XCTAssertEqual(decoded.pid, 1234)
    }

    func testMicEventEncoding() throws {
        let apps = [
            AppInfo(bundleId: "us.zoom.xos", name: "zoom.us", pid: 123, path: "/Applications/zoom.us.app")
        ]
        let event = MicEvent(apps: apps)

        let encoded = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(MicEvent.self, from: encoded)

        XCTAssertEqual(decoded.event, "mic")
        XCTAssertEqual(decoded.apps.count, 1)
        XCTAssertEqual(decoded.apps[0].bundleId, "us.zoom.xos")
    }
}
