// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "vocify-mac-helper",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "vocify-mac-helper", targets: ["VocifyMacHelper"]),
        .library(name: "VocifyMacHelperCore", targets: ["VocifyMacHelperCore"])
    ],
    targets: [
        .target(
            name: "VocifyMacHelperCore",
            dependencies: [],
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("AppKit")
            ]
        ),
        .executableTarget(
            name: "VocifyMacHelper",
            dependencies: ["VocifyMacHelperCore"],
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("AppKit")
            ]
        ),
        .testTarget(
            name: "VocifyMacHelperCoreTests",
            dependencies: ["VocifyMacHelperCore"]
        )
    ]
)
