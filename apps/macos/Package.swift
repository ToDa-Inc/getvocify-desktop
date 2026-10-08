// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VocifyCompanion",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "VocifyCompanion", targets: ["VocifyCompanion"]),
        .executable(name: "VocifyMeetHost", targets: ["VocifyMeetHost"]),
    ],
    targets: [
        .target(name: "VocifyCore"),
        .executableTarget(
            name: "VocifyCompanion",
            dependencies: ["VocifyCore"],
            exclude: ["bridge.js", "Resources"]
        ),
        .executableTarget(name: "VocifyMeetHost", dependencies: ["VocifyCore"]),
        .executableTarget(name: "VocifyCoreChecks", dependencies: ["VocifyCore"]),
    ]
)
