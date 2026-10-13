import AVFoundation
import AppKit
import CoreAudio
import Foundation

/// What `vocify-mac-helper audio` runs: one capture of everything the Mac plays, PCM to stdout (PROTOCOL.md).
protocol AudioCapture: AnyObject {
    /// Called once when capture cannot go on; the helper then exits.
    var onEnd: ((_ event: String, _ reason: String) -> Void)? { get set }
    func start()
    func stop()
}

extension SystemAudioCapture: AudioCapture {}

/// `vocify-mac-helper audio` on macOS 14.2+: a Core Audio process tap on every process but Vocify's own, read through a
/// private aggregate device. Unlike ScreenCaptureKit it also hears audio that no app window plays: an iPhone call or a
/// FaceTime call on the Mac runs its audio in a system service. Permission: System Audio Recording (the app's
/// NSAudioCaptureUsageDescription). macOS asks on the first start; a refusal is not reported, the tap then hears silence.
/// A change of output device rebuilds the device the tap is read through.
@available(macOS 14.2, *)
final class TapAudioCapture: AudioCapture, @unchecked Sendable {
    var onEnd: ((_ event: String, _ reason: String) -> Void)?

    private let queue = DispatchQueue(label: "vocify.helper.tap", qos: .userInteractive)
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var aggregate = AudioObjectID(kAudioObjectUnknown)
    private var ioProc: AudioDeviceIOProcID?
    private var converter: AVAudioConverter?
    private var tapFormat: AVAudioFormat?
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
    private var lastWriteAt = Date()
    private var timer: DispatchSourceTimer?
    private var outputListener: AudioObjectPropertyListenerBlock?
    /// 100 ms of silence: written when nothing arrived for a while, so the stream never stalls.
    private static let silence = Data(count: 3200)

    func start() {
        queue.async {
            guard self.open() else {
                self.onEnd?("error", "capture_failed")
                return
            }
            self.lastWriteAt = Date()
            status(["event": "started"])
            self.watch()
        }
    }

    func stop() {
        queue.sync {
            timer?.cancel()
            timer = nil
            if let listener = outputListener {
                var address = Self.defaultOutputAddress
                AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, listener)
                outputListener = nil
            }
            close()
        }
    }

    // MARK: The tap and the device it is read through (on `queue`)

    private func open() -> Bool {
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: Self.vocifyProcesses())
        description.isPrivate = true
        description.muteBehavior = .unmuted
        guard AudioHardwareCreateProcessTap(description, &tap) == noErr else { return false }
        guard let outputUID = Self.defaultOutputUID() else {
            close()
            return false
        }
        let settings: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Vocify call audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        guard AudioHardwareCreateAggregateDevice(settings as CFDictionary, &aggregate) == noErr else {
            close()
            return false
        }
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var formatAddress = Self.address(kAudioTapPropertyFormat)
        guard AudioObjectGetPropertyData(tap, &formatAddress, 0, nil, &size, &asbd) == noErr,
              let format = AVAudioFormat(streamDescription: &asbd),
              let converter = AVAudioConverter(from: format, to: target) else {
            close()
            return false
        }
        tapFormat = format
        self.converter = converter
        // Read on a queue: Core Audio's own thread calls the block, the PCM is written in order on `queue`.
        let created = AudioDeviceCreateIOProcIDWithBlock(&ioProc, aggregate, queue) { [weak self] _, input, _, _, _ in
            self?.receive(input)
        }
        // The first start is what makes macOS ask for System Audio Recording; it returns once the rep answered.
        guard created == noErr, let ioProc, AudioDeviceStart(aggregate, ioProc) == noErr else {
            close()
            return false
        }
        return true
    }

    private func close() {
        if let ioProc, aggregate != kAudioObjectUnknown {
            AudioDeviceStop(aggregate, ioProc)
            AudioDeviceDestroyIOProcID(aggregate, ioProc)
        }
        ioProc = nil
        if aggregate != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregate) }
        aggregate = AudioObjectID(kAudioObjectUnknown)
        if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
        tap = AudioObjectID(kAudioObjectUnknown)
        converter = nil
        tapFormat = nil
    }

    private func receive(_ input: UnsafePointer<AudioBufferList>) {
        guard let format = tapFormat, let converter,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: input, deallocator: nil),
              buffer.frameLength > 0 else { return }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        // One converter for the whole capture, so resampling carries over from buffer to buffer.
        converter.convert(to: out, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let channel = out.int16ChannelData?[0] else { return }
        write(Data(bytes: channel, count: Int(out.frameLength) * MemoryLayout<Int16>.size))
    }

    private func write(_ data: Data) {
        lastWriteAt = Date()
        FileHandle.standardOutput.write(data)
    }

    // MARK: Keeping it alive (on `queue`)

    private func watch() {
        var address = Self.defaultOutputAddress
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.reopen() }
        if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue, listener) == noErr {
            outputListener = listener
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        timer.setEventHandler { [weak self] in
            guard let self, Date().timeIntervalSince(self.lastWriteAt) > 0.3 else { return }
            self.write(Self.silence)
        }
        timer.resume()
        self.timer = timer
    }

    /// The output device changed (headphones, AirPods): the old device may be gone, so the tap is read through the new one.
    private func reopen() {
        close()
        if !open() { onEnd?("lost", "device_changed") }
    }

    // MARK: Core Audio lookups

    /// Vocify's own processes (the app that started this helper, its helpers, this helper): never in the call audio.
    private static func vocifyProcesses() -> [AudioObjectID] {
        let parent = getppid()
        let own = getpid()
        let bundle = NSRunningApplication(processIdentifier: parent)?.bundleIdentifier
        var address = address(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &objects) == noErr else { return [] }
        return objects.filter { object in
            var pid: pid_t = 0
            var pidSize = UInt32(MemoryLayout<pid_t>.size)
            var pidAddress = Self.address(kAudioProcessPropertyPID)
            AudioObjectGetPropertyData(object, &pidAddress, 0, nil, &pidSize, &pid)
            if pid == parent || pid == own { return true }
            guard let bundle, let id = string(object, kAudioProcessPropertyBundleID) else { return false }
            return id == bundle || id.hasPrefix(bundle + ".")
        }
    }

    private static func defaultOutputUID() -> String? {
        var device = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = address(kAudioHardwarePropertyDefaultSystemOutputDevice)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr else { return nil }
        return string(device, kAudioDevicePropertyDeviceUID)
    }

    private static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = address(selector)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }

    private static var defaultOutputAddress: AudioObjectPropertyAddress {
        address(kAudioHardwarePropertyDefaultSystemOutputDevice)
    }
}
