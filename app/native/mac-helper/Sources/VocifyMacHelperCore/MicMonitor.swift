import AppKit
import CoreAudio
import Darwin
import Foundation

/// Monitors which applications are using the microphone
public class MicMonitor {
    private var timer: Timer?
    private var listenedDevice: AudioObjectID?
    private var deviceListener: AudioObjectPropertyListenerBlock?
    private var processListeners: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]
    private var lastReportedApps: [AppInfo]?
    private var onAppsChanged: (([AppInfo]) -> Void)?

    public init() {}

    /// Start monitoring microphone activity
    /// - Parameter onAppsChanged: Called whenever the set of apps using mic changes
    public func start(onAppsChanged: @escaping ([AppInfo]) -> Void) {
        guard timer == nil else { return }

        self.onAppsChanged = onAppsChanged

        // Poll every 1 second as fallback (required for non-default input devices)
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.tick()
        }

        // Listen to default device changes
        var defaultInput = address(kAudioHardwarePropertyDefaultInputDevice)
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &defaultInput,
            .main
        ) { [weak self] _, _ in
            self?.listenToDefaultInput()
            self?.tick()
        }

        listenToDefaultInput()

        // Listen to process list changes (macOS 14.2+)
        if #available(macOS 14.2, *) {
            var list = address(kAudioHardwarePropertyProcessObjectList)
            AudioObjectAddPropertyListenerBlock(
                AudioObjectID(kAudioObjectSystemObject),
                &list,
                .main
            ) { [weak self] _, _ in
                self?.listenToProcesses()
                self?.tick()
            }
            listenToProcesses()
        }

        // Report initial state
        tick()
    }

    /// Stop monitoring
    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    // MARK: - Private

    @available(macOS 14.2, *)
    private func listenToProcesses() {
        let current = Set(objects(kAudioHardwarePropertyProcessObjectList))
        var input = address(kAudioProcessPropertyIsRunningInput)

        // Remove listeners for dead processes
        for (process, block) in processListeners where !current.contains(process) {
            AudioObjectRemovePropertyListenerBlock(process, &input, .main, block)
            processListeners[process] = nil
        }

        // Add listeners for new processes
        for process in current where processListeners[process] == nil {
            let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
                self?.tick()
            }
            if AudioObjectAddPropertyListenerBlock(process, &input, .main, block) == noErr {
                processListeners[process] = block
            }
        }
    }

    private func listenToDefaultInput() {
        guard let device = objects(kAudioHardwarePropertyDefaultInputDevice).first,
              device != listenedDevice else { return }

        var running = address(kAudioDevicePropertyDeviceIsRunningSomewhere)

        if let old = listenedDevice, let block = deviceListener {
            AudioObjectRemovePropertyListenerBlock(old, &running, .main, block)
        }

        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.tick()
        }

        if AudioObjectAddPropertyListenerBlock(device, &running, .main, block) == noErr {
            listenedDevice = device
            deviceListener = block
        }
    }

    private func tick() {
        let apps = getAppsUsingMicrophone()
        if lastReportedApps == nil || apps != lastReportedApps {
            lastReportedApps = apps
            onAppsChanged?(apps)
        }
    }

    /// Get all applications currently using the microphone
    private func getAppsUsingMicrophone() -> [AppInfo] {
        var result: [AppInfo] = []

        if #available(macOS 14.2, *) {
            let ownPID = ProcessInfo.processInfo.processIdentifier
            let ownBundle = Bundle.main.bundleIdentifier ?? ""

            for process in objects(kAudioHardwarePropertyProcessObjectList) {
                guard uint32(process, kAudioProcessPropertyIsRunningInput) == 1 else { continue }

                let pid = pid_t(bitPattern: uint32(process, kAudioProcessPropertyPID) ?? 0)
                let bundleId = string(process, kAudioProcessPropertyBundleID) ?? ""

                // Skip own processes
                if pid == ownPID || (!ownBundle.isEmpty && bundleId.hasPrefix(ownBundle)) {
                    continue
                }

                // Include all apps with running input (let the Electron side filter)
                if let runningApp = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
                    let displayName = runningApp.localizedName ?? bundleId
                    let executablePath = runningApp.executableURL?.path ?? ""

                    let info = AppInfo(
                        bundleId: bundleId,
                        name: displayName,
                        pid: pid,
                        path: executablePath
                    )
                    result.append(info)
                } else if !bundleId.isEmpty {
                    // App not running but has a pid reference - include it anyway
                    let info = AppInfo(
                        bundleId: bundleId,
                        name: bundleId,
                        pid: pid,
                        path: ""
                    )
                    result.append(info)
                }
            }
        }

        return result.sorted { ($0.bundleId, $0.pid) < ($1.bundleId, $1.pid) }
    }

    // MARK: - Core Audio Helpers

    private func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private func objects(_ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
        var address = address(selector)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)

        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr,
              size > 0 else { return [] }

        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }

        return ids
    }

    private func uint32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
        var address = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)

        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
    }

    private func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)

        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }
}
