// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VocifyCompanion",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "VocifyCompanion", targets: ["VocifyCompanion"]),
    ],
    targets: [
        .target(name: "VocifyCore"),
        .executableTarget(
            name: "VocifyCompanion",
            dependencies: ["VocifyCore"],
            exclude: ["bridge.js", "Resources"]
        ),
        .executableTarget(name: "VocifyCoreChecks", dependencies: ["VocifyCore"]),
    ]
)
