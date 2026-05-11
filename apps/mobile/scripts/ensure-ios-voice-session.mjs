import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const iosProjectDir = path.join(appDir, "ios", "App");
const iosAppDir = path.join(iosProjectDir, "App");
const projectPath = path.join(iosProjectDir, "App.xcodeproj", "project.pbxproj");
const pluginFilename = "CrewCmdVoiceSessionPlugin.swift";
const pluginPath = path.join(iosAppDir, pluginFilename);
const bridgeFilename = "CrewCmdBridgeViewController.swift";
const bridgePath = path.join(iosAppDir, bridgeFilename);
const storyboardPath = path.join(iosAppDir, "Base.lproj", "Main.storyboard");
const infoPlistPath = path.join(iosAppDir, "Info.plist");
const generatedDir = path.join(appDir, process.env.CREWCMD_MOBILE_OUTPUT_DIR || ".generated");

const PLUGIN_SOURCE = String.raw`import Foundation
import AVFoundation
import Capacitor
import UIKit

private enum CrewCmdVoiceState: String {
    case idle
    case listening
    case recording
    case transcribing
    case error
}

@objc(CrewCmdVoiceSessionPlugin)
public class CrewCmdVoiceSessionPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    public let identifier = "CrewCmdVoiceSessionPlugin"
    public let jsName = "CrewCmdVoiceSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "muteMic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speakText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private let keepaliveMixer = AVAudioMixerNode()
    private let captureQueue = DispatchQueue(label: "dev.crewcmd.voice-session.capture")
    private var state: CrewCmdVoiceState = .idle
    private var active = false
    private var micMuted = false
    private var currentSessionId: String?
    private var baseUrl: String?
    private var uploadToken: String?
    private var agent: String?
    private var gatewayAgent: String?
    private var companyId: String?
    private var sessionKey: String?
    private var lastError: String?
    private var lastLevel: Double = 0
    private var levelFrameCount = 0
    private var recordingSamples = [Int16]()
    private var recordingSampleRate: Double = 16000
    private var recordingChannels: Int = 1
    private var speechStartedAt: TimeInterval?
    private var silenceStartedAt: TimeInterval?
    private var recordingStartedAt: TimeInterval?
    private var uploadInFlight = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var notificationObservers = [NSObjectProtocol]()
    private var lastAudioBufferAt: TimeInterval?
    private var audioWatchdog: DispatchSourceTimer?
    private var keepaliveGraphInstalled = false
    private var audioPlayer: AVAudioPlayer?
    private var audioPlaybackCall: CAPPluginCall?
    private var audioPlaybackData: Data?
    private let speechSynthesizer = AVSpeechSynthesizer()
    private var speechCall: CAPPluginCall?
    private var cachedApplicationState: UIApplication.State = .active
    private var playbackSuppressionUntil: TimeInterval = 0

    private let silenceThreshold = 0.005
    private let speechStartMs = 100.0
    private let silenceEndMs = 700.0
    private let minRecordingMs = 250.0
    private let maxRecordingMs = 20000.0

    public override func load() {
        super.load()
        DispatchQueue.main.async { [weak self] in
            self?.cachedApplicationState = UIApplication.shared.applicationState
        }
        speechSynthesizer.delegate = self
        installLifecycleObservers()
    }

    deinit {
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "platform": "ios",
            "backgroundCapable": true,
            "nativeTranscription": true
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        let sessionId = call.getString("voiceSessionId") ?? UUID().uuidString
        currentSessionId = sessionId
        baseUrl = normalizedBaseUrl(call.getString("baseUrl"))
        uploadToken = call.getString("uploadToken")
        agent = call.getString("agent")
        gatewayAgent = call.getString("gatewayAgent")
        companyId = call.getString("companyId")
        sessionKey = call.getString("sessionKey")
        micMuted = call.getBool("muted") ?? false
        lastError = nil

        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            guard let self = self else { return }
            self.captureQueue.async {
                guard granted else {
                    self.lastError = "Microphone permission denied"
                    self.state = .error
                    self.notifyDiagnostic("native.permission.denied", detail: [:])
                    DispatchQueue.main.async {
                        call.reject("Microphone permission denied")
                    }
                    return
                }

                do {
                    self.active = true
                    try self.configureAudioSession()
                    try self.startEngine()
                    self.startAudioWatchdog()
                    self.state = .listening
                    self.notifyDiagnostic("native.config.base-url", detail: self.baseUrlDetail())
                    self.notifyDiagnostic("native.engine.started", detail: self.audioSessionDetail())
                    DispatchQueue.main.async {
                        call.resolve(self.statusPayload())
                    }
                } catch {
                    self.active = false
                    self.lastError = error.localizedDescription
                    self.state = .error
                    self.notifyDiagnostic("native.engine.error", detail: ["message": error.localizedDescription])
                    DispatchQueue.main.async {
                        call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        captureQueue.async {
            self.stopAudioWatchdog()
            DispatchQueue.main.async {
                self.stopAudioPlayback(cancelPending: true)
                self.stopSpeechPlayback(cancelPending: true)
            }
            self.stopEngine()
            self.active = false
            self.state = .idle
            self.resetRecording()
            self.notifyDiagnostic("native.stop.completed", detail: [:])
            DispatchQueue.main.async {
                call.resolve(self.statusPayload())
            }
        }
    }

    @objc func muteMic(_ call: CAPPluginCall) {
        captureQueue.async {
            self.micMuted = call.getBool("muted") ?? false
            if self.micMuted {
                self.resetRecording()
                self.state = self.active ? .listening : .idle
            }
            self.notifyDiagnostic("native.mute.changed", detail: ["muted": self.micMuted])
            DispatchQueue.main.async {
                call.resolve(self.statusPayload())
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusPayload())
    }

    @objc func playAudio(_ call: CAPPluginCall) {
        guard let dataBase64 = call.getString("dataBase64"),
              let data = Data(base64Encoded: dataBase64) else {
            call.reject("Invalid audio payload")
            return
        }

        let contentType = call.getString("contentType") ?? "application/octet-stream"
        let playbackRate = max(0.5, min(2.0, call.getDouble("playbackRate") ?? 1.0))

        captureQueue.async {
            do {
                try self.configureAudioSession()
                DispatchQueue.main.async {
                    do {
                        self.stopAudioPlayback(cancelPending: true)
                        self.audioPlaybackData = data
                        let player = try AVAudioPlayer(data: data)
                        player.delegate = self
                        player.enableRate = true
                        player.rate = Float(playbackRate)
                        player.prepareToPlay()
                        self.audioPlayer = player
                        self.audioPlaybackCall = call

                        guard player.play() else {
                            self.audioPlaybackCall = nil
                            self.audioPlayer = nil
                            self.audioPlaybackData = nil
                            call.reject("Native audio playback did not start")
                            return
                        }

                        self.notifyDiagnostic("native.tts.play.start", detail: [
                            "bytes": data.count,
                            "contentType": contentType,
                            "duration": player.duration,
                            "rate": playbackRate
                        ])
                    } catch {
                        self.audioPlaybackCall = nil
                        self.audioPlayer = nil
                        self.audioPlaybackData = nil
                        self.lastError = error.localizedDescription
                        self.notifyDiagnostic("native.tts.play.error", detail: ["message": error.localizedDescription])
                        call.reject(error.localizedDescription)
                    }
                }
            } catch {
                self.lastError = error.localizedDescription
                self.notifyDiagnostic("native.tts.session.error", detail: ["message": error.localizedDescription])
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func stopAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopAudioPlayback(cancelPending: true)
            self.stopSpeechPlayback(cancelPending: true)
            self.notifyDiagnostic("native.tts.stop", detail: [:])
            call.resolve(self.statusPayload())
        }
    }

    @objc func speakText(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            call.reject("Text is required")
            return
        }

        let playbackRate = max(0.5, min(2.0, call.getDouble("playbackRate") ?? 1.0))
        let voiceId = call.getString("voiceId")
        let voiceName = call.getString("voiceName")
        let language = call.getString("language")

        captureQueue.async {
            do {
                try self.configureAudioSession()
                DispatchQueue.main.async {
                    self.stopAudioPlayback(cancelPending: true)
                    self.stopSpeechPlayback(cancelPending: true)

                    let utterance = AVSpeechUtterance(string: text)
                    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(playbackRate)
                    utterance.pitchMultiplier = 1.0
                    utterance.volume = 1.0
                    utterance.voice = self.preferredSpeechVoice(voiceId: voiceId, voiceName: voiceName, language: language)

                    self.speechCall = call
                    self.notifyDiagnostic("native.tts.speech.queued", detail: [
                        "characters": text.count,
                        "rate": playbackRate,
                        "requestedVoiceId": voiceId ?? "",
                        "requestedVoiceName": voiceName ?? "",
                        "voice": utterance.voice?.identifier ?? "system",
                        "voiceName": utterance.voice?.name ?? "system"
                    ])
                    self.speechSynthesizer.speak(utterance)
                }
            } catch {
                self.lastError = error.localizedDescription
                self.notifyDiagnostic("native.tts.speech.session-error", detail: ["message": error.localizedDescription])
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        suppressRecordingForPlayback(tailMs: 2000)
        notifyDiagnostic("native.tts.speech.started", detail: ["characters": utterance.speechString.count])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        suppressRecordingForPlayback(tailMs: 2500)
        notifyDiagnostic("native.tts.speech.finished", detail: ["characters": utterance.speechString.count])
        let call = speechCall
        speechCall = nil
        call?.resolve(statusPayload())
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        suppressRecordingForPlayback(tailMs: 500)
        notifyDiagnostic("native.tts.speech.cancelled", detail: ["characters": utterance.speechString.count])
        let call = speechCall
        speechCall = nil
        call?.reject("Native speech playback cancelled")
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        suppressRecordingForPlayback(tailMs: 700)
        notifyDiagnostic("native.tts.play.finished", detail: [
            "success": flag,
            "duration": player.duration
        ])
        let call = audioPlaybackCall
        audioPlaybackCall = nil
        audioPlayer = nil
        audioPlaybackData = nil
        call?.resolve(statusPayload())
    }

    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let message = error?.localizedDescription ?? "Native audio decode failed"
        lastError = message
        notifyDiagnostic("native.tts.decode.error", detail: ["message": message])
        let call = audioPlaybackCall
        audioPlaybackCall = nil
        audioPlayer = nil
        audioPlaybackData = nil
        call?.reject(message)
    }

    private func preferredSpeechVoice(voiceId: String? = nil, voiceName: String? = nil, language: String? = nil) -> AVSpeechSynthesisVoice? {
        let voices = AVSpeechSynthesisVoice.speechVoices()

        if let voiceId = voiceId, !voiceId.isEmpty {
            if let exact = voices.first(where: { $0.identifier == voiceId && !isBlockedSpeechVoice($0) }) {
                return exact
            }
            if let byName = voices.first(where: { $0.name == voiceId && !isBlockedSpeechVoice($0) }) {
                return byName
            }
        }

        if let voiceName = voiceName, !voiceName.isEmpty {
            let candidates = voices
                .filter { !isBlockedSpeechVoice($0) && $0.name.localizedCaseInsensitiveContains(voiceName) }
                .sorted { $0.quality.rawValue > $1.quality.rawValue }
            if let voice = candidates.first {
                return voice
            }
        }

        if let language = language, !language.isEmpty {
            let candidates = voices
                .filter { $0.language == language && isNaturalSpeechVoice($0) && !isBlockedSpeechVoice($0) }
                .sorted { $0.quality.rawValue > $1.quality.rawValue }
            if let voice = candidates.first {
                return voice
            }
        }

        let preferredVoiceNames = ["Daniel", "Matilda", "Ava", "Zoe", "Samantha", "Karen", "Moira", "Serena", "Siri"]
        for preferredName in preferredVoiceNames {
            let candidates = voices
                .filter { !isBlockedSpeechVoice($0) && $0.name.localizedCaseInsensitiveContains(preferredName) }
                .sorted { $0.quality.rawValue > $1.quality.rawValue }
            if let voice = candidates.first {
                return voice
            }
        }

        let preferredLanguages = ["en-AU", "en-US", "en-GB"]
        for language in preferredLanguages {
            let candidates = voices
                .filter { $0.language == language && isNaturalSpeechVoice($0) && !isBlockedSpeechVoice($0) }
                .sorted { $0.quality.rawValue > $1.quality.rawValue }
            if let voice = candidates.first {
                return voice
            }
        }

        return ["en-AU", "en-US", "en-GB"]
            .compactMap { AVSpeechSynthesisVoice(language: $0) }
            .first { !isBlockedSpeechVoice($0) }
    }

    private func isNaturalSpeechVoice(_ voice: AVSpeechSynthesisVoice) -> Bool {
        let identifier = voice.identifier.lowercased()
        let name = voice.name.lowercased()
        let blockedTerms = ["compact", "eloquence", "eddy", "flo", "grandma", "grandpa", "reed", "rocko", "sandy", "shelley", "super-compact", "novelty"]
        return !blockedTerms.contains { identifier.contains($0) || name.contains($0) }
    }

    private func isBlockedSpeechVoice(_ voice: AVSpeechSynthesisVoice) -> Bool {
        let identifier = voice.identifier.lowercased()
        let name = voice.name.lowercased()
        return identifier.contains("albert") || name.contains("albert")
    }

    private func suppressRecordingForPlayback(tailMs: Double) {
        captureQueue.async {
            let now = Date().timeIntervalSince1970 * 1000
            self.playbackSuppressionUntil = max(self.playbackSuppressionUntil, now + tailMs)
            self.resetRecording()
            if self.active {
                self.state = .listening
            }
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker, .mixWithOthers]
        )
        try session.setPreferredSampleRate(16_000)
        try session.setPreferredIOBufferDuration(0.02)
        try session.setActive(true)
        notifyDiagnostic("native.audio-session.configured", detail: audioSessionDetail())
    }

    private func stopAudioPlayback(cancelPending: Bool) {
        let wasPlaying = audioPlayer?.isPlaying ?? false
        audioPlayer?.stop()
        audioPlayer = nil
        audioPlaybackData = nil

        if cancelPending {
            audioPlaybackCall?.reject("Native audio playback stopped")
        }
        audioPlaybackCall = nil

        if wasPlaying {
            notifyDiagnostic("native.tts.play.stopped", detail: [:])
        }
    }

    private func stopSpeechPlayback(cancelPending: Bool) {
        let wasSpeaking = speechSynthesizer.isSpeaking
        if wasSpeaking {
            speechSynthesizer.stopSpeaking(at: .immediate)
        }

        if cancelPending {
            speechCall?.reject("Native speech playback stopped")
        }
        speechCall = nil

        if wasSpeaking {
            notifyDiagnostic("native.tts.speech.stopped", detail: [:])
        }
    }

    private func startEngine() throws {
        if audioEngine.isRunning {
            return
        }

        let input = audioEngine.inputNode
        let inputFormat = input.inputFormat(forBus: 0)
        let outputFormat = input.outputFormat(forBus: 0)
        let format = inputFormat.sampleRate > 0 && inputFormat.channelCount > 0 ? inputFormat : outputFormat
        recordingSampleRate = format.sampleRate
        recordingChannels = Int(format.channelCount)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.captureQueue.async {
                self?.handleAudioBuffer(buffer)
            }
        }

        installKeepaliveInputGraph(input: input, format: format)
        lastAudioBufferAt = Date().timeIntervalSince1970 * 1000
        audioEngine.prepare()
        try audioEngine.start()
    }

    private func installKeepaliveInputGraph(input: AVAudioInputNode, format: AVAudioFormat) {
        if !keepaliveGraphInstalled {
            audioEngine.attach(keepaliveMixer)
            keepaliveMixer.outputVolume = 0
            keepaliveGraphInstalled = true
        }

        audioEngine.disconnectNodeOutput(input)
        audioEngine.disconnectNodeOutput(keepaliveMixer)
        audioEngine.connect(input, to: keepaliveMixer, format: format)
        audioEngine.connect(keepaliveMixer, to: audioEngine.mainMixerNode, format: format)
        audioEngine.mainMixerNode.outputVolume = 0
    }

    private func stopEngine() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.disconnectNodeOutput(audioEngine.inputNode)
        audioEngine.disconnectNodeOutput(keepaliveMixer)
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            lastError = error.localizedDescription
        }
        lastLevel = 0
    }

    private func handleAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return }
        recordingSampleRate = buffer.format.sampleRate
        recordingChannels = Int(buffer.format.channelCount)
        lastAudioBufferAt = Date().timeIntervalSince1970 * 1000
        guard active, !micMuted else { return }

        let samples = channelData[0]
        var sum: Float = 0
        var intSamples = [Int16]()
        intSamples.reserveCapacity(frameLength)
        for index in 0..<frameLength {
            let sample = max(-1.0, min(1.0, samples[index]))
            sum += sample * sample
            intSamples.append(Int16(sample * Float(Int16.max)))
        }

        let rms = sqrt(sum / Float(frameLength))
        let normalized = min(Double(rms) * 10.0, 1.0)
        lastLevel = normalized
        levelFrameCount += 1
        let now = Date().timeIntervalSince1970 * 1000

        if levelFrameCount % 6 == 0 {
            notifyListeners("voiceLevel", data: [
                "voiceSessionId": currentSessionId ?? "",
                "level": normalized,
                "rms": Double(rms),
                "threshold": silenceThreshold,
                "audioSessionActive": self.active,
                "backgroundCapable": true,
                "applicationState": self.currentApplicationStateName(),
                "engineRunning": self.audioEngine.isRunning
            ])
        }

        guard !uploadInFlight else { return }
        guard now >= playbackSuppressionUntil else {
            resetRecording()
            return
        }

        if Double(rms) >= silenceThreshold {
            silenceStartedAt = nil
            if speechStartedAt == nil {
                speechStartedAt = now
            }
            if recordingStartedAt == nil, let started = speechStartedAt, now - started >= speechStartMs {
                recordingStartedAt = now
                recordingSamples.removeAll(keepingCapacity: true)
                state = .recording
                notifyDiagnostic("native.recording.started", detail: ["level": normalized])
            }
        } else {
            speechStartedAt = nil
            if recordingStartedAt != nil, silenceStartedAt == nil {
                silenceStartedAt = now
            }
        }

        if recordingStartedAt != nil {
            recordingSamples.append(contentsOf: intSamples)
            let recordingMs = now - (recordingStartedAt ?? now)
            let silenceMs = silenceStartedAt.map { now - $0 } ?? 0
            if (recordingMs >= minRecordingMs && silenceMs >= silenceEndMs) || recordingMs >= maxRecordingMs {
                finishRecording(recordingMs: recordingMs)
            }
        }
    }

    private func finishRecording(recordingMs: Double) {
        guard !recordingSamples.isEmpty else {
            resetRecording()
            return
        }
        let appState = cachedApplicationState
        let samples = recordingSamples
        let sampleRate = recordingSampleRate
        resetRecording()
        state = .transcribing
        uploadInFlight = true
        beginBackgroundTask()
        notifyDiagnostic("native.recording.finished", detail: [
            "durationMs": recordingMs,
            "samples": samples.count,
            "sampleRate": sampleRate,
            "applicationState": applicationStateName(appState)
        ])
        uploadWav(samples: samples, sampleRate: sampleRate)
    }

    private func resetRecording() {
        recordingSamples.removeAll(keepingCapacity: true)
        speechStartedAt = nil
        silenceStartedAt = nil
        recordingStartedAt = nil
    }

    private func uploadWav(samples: [Int16], sampleRate: Double) {
        guard let uploadToken = uploadToken, let url = apiUrl(path: "/api/stt") else {
            uploadInFlight = false
            endBackgroundTask()
            lastError = "Native voice upload is not configured"
            state = active ? .listening : .idle
            notifyDiagnostic("native.upload.not-configured", detail: baseUrlDetail())
            notifyTranscript(text: nil, provider: nil, error: lastError)
            return
        }

        let boundary = "CrewCmdVoiceBoundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(uploadToken)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipartBody(boundary: boundary, wavData: wavData(samples: samples, sampleRate: sampleRate))

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            self.captureQueue.async {
                self.uploadInFlight = false
                self.endBackgroundTask()
                self.state = self.active ? .listening : .idle

                if let error = error {
                    self.lastError = error.localizedDescription
                    self.notifyDiagnostic("native.upload.error", detail: ["message": error.localizedDescription])
                    self.notifyTranscript(text: nil, provider: nil, error: error.localizedDescription)
                    return
                }

                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(statusCode), let data = data else {
                    let message = "Native transcription failed with status \(statusCode)"
                    self.lastError = message
                    self.notifyDiagnostic("native.upload.status-error", detail: ["status": statusCode])
                    self.notifyTranscript(text: nil, provider: nil, error: message)
                    return
                }

                do {
                    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    let text = (json?["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    let provider = json?["provider"] as? String
                    self.notifyDiagnostic("native.transcription.complete", detail: [
                        "hasText": !(text?.isEmpty ?? true),
                        "provider": provider ?? "unknown"
                    ])
                    self.notifyTranscript(text: text, provider: provider, error: nil)
                    if let text = text, !text.isEmpty {
                        self.sendChatMessage(text)
                    }
                } catch {
                    self.lastError = error.localizedDescription
                    self.notifyDiagnostic("native.transcription.parse-error", detail: ["message": error.localizedDescription])
                    self.notifyTranscript(text: nil, provider: nil, error: error.localizedDescription)
                }
            }
        }.resume()
    }



    private func installLifecycleObservers() {
        let center = NotificationCenter.default
        notificationObservers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            self?.captureQueue.async {
                self?.handleAudioSessionInterruption(notification)
            }
        })
        notificationObservers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            self?.captureQueue.async {
                self?.handleAudioRouteChange(notification)
            }
        })
        notificationObservers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] _ in
            self?.captureQueue.async {
                self?.recoverAudioEngine(reason: "media-services-reset")
            }
        })
        notificationObservers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cachedApplicationState = UIApplication.shared.applicationState
            self?.captureQueue.async {
                self?.notifyDiagnostic("native.app.active", detail: self?.audioSessionDetail() ?? [:])
            }
        })
        notificationObservers.append(center.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cachedApplicationState = UIApplication.shared.applicationState
            self?.captureQueue.async {
                self?.notifyDiagnostic("native.app.inactive", detail: self?.audioSessionDetail() ?? [:])
            }
        })
        notificationObservers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cachedApplicationState = UIApplication.shared.applicationState
            self?.captureQueue.async {
                self?.notifyDiagnostic("native.app.background", detail: self?.audioSessionDetail() ?? [:])
                self?.recoverAudioEngine(reason: "app-backgrounded", forceRestart: true)
            }
        })
        notificationObservers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cachedApplicationState = UIApplication.shared.applicationState
            self?.captureQueue.async {
                self?.notifyDiagnostic("native.app.foreground", detail: self?.audioSessionDetail() ?? [:])
            }
        })
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
        switch type {
        case .began:
            notifyDiagnostic("native.audio-session.interruption.began", detail: audioSessionDetail())
        case .ended:
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            notifyDiagnostic("native.audio-session.interruption.ended", detail: [
                "shouldResume": options.contains(.shouldResume),
                "applicationState": currentApplicationStateName()
            ])
            recoverAudioEngine(reason: "interruption-ended", forceRestart: true)
        @unknown default:
            notifyDiagnostic("native.audio-session.interruption.unknown", detail: audioSessionDetail())
        }
    }

    private func handleAudioRouteChange(_ notification: Notification) {
        let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        notifyDiagnostic("native.audio-session.route-change", detail: [
            "reason": reason.map { String($0.rawValue) } ?? "unknown",
            "applicationState": currentApplicationStateName(),
            "engineRunning": audioEngine.isRunning
        ])
        if active {
            recoverAudioEngine(reason: "route-change", forceRestart: true)
        }
    }

    private func recoverAudioEngine(reason: String, forceRestart: Bool = false) {
        guard active else { return }
        do {
            try configureAudioSession()
            if forceRestart || !audioEngine.isRunning {
                if audioEngine.isRunning {
                    audioEngine.stop()
                }
                audioEngine.inputNode.removeTap(onBus: 0)
                audioEngine.disconnectNodeOutput(audioEngine.inputNode)
                audioEngine.disconnectNodeOutput(keepaliveMixer)
                try startEngine()
            }
            notifyDiagnostic("native.engine.recovered", detail: [
                "reason": reason,
                "forceRestart": forceRestart,
                "engineRunning": audioEngine.isRunning,
                "applicationState": currentApplicationStateName()
            ])
        } catch {
            lastError = error.localizedDescription
            state = .error
            notifyDiagnostic("native.engine.recover.error", detail: [
                "reason": reason,
                "message": error.localizedDescription
            ])
        }
    }

    private func startAudioWatchdog() {
        stopAudioWatchdog()
        let timer = DispatchSource.makeTimerSource(queue: captureQueue)
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.active else { return }
            let now = Date().timeIntervalSince1970 * 1000
            let lastBuffer = self.lastAudioBufferAt ?? 0
            let staleAudio = now - lastBuffer > 6000
            if !self.audioEngine.isRunning || (self.cachedApplicationState != .active && staleAudio) {
                self.notifyDiagnostic("native.audio-watchdog.recover", detail: [
                    "engineRunning": self.audioEngine.isRunning,
                    "msSinceLastBuffer": lastBuffer > 0 ? now - lastBuffer : -1,
                    "lastLevel": self.lastLevel,
                    "threshold": self.silenceThreshold,
                    "applicationState": self.currentApplicationStateName()
                ])
                self.recoverAudioEngine(reason: "audio-watchdog", forceRestart: true)
            } else if self.state == .listening {
                self.notifyDiagnostic("native.audio-watchdog.listening", detail: [
                    "msSinceLastBuffer": lastBuffer > 0 ? now - lastBuffer : -1,
                    "lastLevel": self.lastLevel,
                    "threshold": self.silenceThreshold,
                    "engineRunning": self.audioEngine.isRunning,
                    "applicationState": self.currentApplicationStateName()
                ])
            }
        }
        audioWatchdog = timer
        timer.resume()
    }

    private func stopAudioWatchdog() {
        audioWatchdog?.cancel()
        audioWatchdog = nil
    }

    private func beginBackgroundTask() {
        DispatchQueue.main.async {
            if self.backgroundTask != .invalid { return }
            self.backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "CrewCmdVoiceUpload") { [weak self] in
                guard let self = self else { return }
                self.captureQueue.async {
                    self.notifyDiagnostic("native.background-task.expired", detail: [:])
                    self.endBackgroundTask()
                }
            }
            self.notifyDiagnostic("native.background-task.begin", detail: ["started": self.backgroundTask != .invalid])
        }
    }

    private func endBackgroundTask() {
        DispatchQueue.main.async {
            guard self.backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(self.backgroundTask)
            self.backgroundTask = .invalid
            self.notifyDiagnostic("native.background-task.end", detail: [:])
        }
    }

    private func applicationStateName(_ state: UIApplication.State) -> String {
        switch state {
        case .active:
            return "active"
        case .inactive:
            return "inactive"
        case .background:
            return "background"
        @unknown default:
            return "unknown"
        }
    }

    private func currentApplicationStateName() -> String {
        applicationStateName(cachedApplicationState)
    }

    private func sendChatMessage(_ text: String) {
        guard let uploadToken = uploadToken, let url = apiUrl(path: "/api/chat") else {
            notifyDiagnostic("native.chat.skipped", detail: ["reason": "chat upload is not configured", "baseUrl": baseUrl ?? NSNull()])
            return
        }

        var body: [String: Any] = [
            "messages": [["role": "user", "content": text]],
            "agentMode": true,
            "clientVisibility": "hidden",
            "notifyOnCompletion": true
        ]
        if let agent = agent { body["agent"] = agent }
        if let gatewayAgent = gatewayAgent { body["gatewayAgent"] = gatewayAgent }
        if let companyId = companyId { body["companyId"] = companyId }
        if let sessionKey = sessionKey { body["sessionKey"] = sessionKey }

        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(uploadToken)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            notifyDiagnostic("native.chat.send.start", detail: ["bytes": request.httpBody?.count ?? 0])
            URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
                guard let self = self else { return }
                self.captureQueue.async {
                    if let error = error {
                        self.notifyDiagnostic("native.chat.send.error", detail: ["message": error.localizedDescription])
                        return
                    }
                    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                    self.notifyDiagnostic("native.chat.send.complete", detail: ["status": statusCode])
                }
            }.resume()
        } catch {
            notifyDiagnostic("native.chat.encode-error", detail: ["message": error.localizedDescription])
        }
    }


    private func normalizedBaseUrl(_ rawBaseUrl: String?) -> String? {
        guard let rawBaseUrl = rawBaseUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !rawBaseUrl.isEmpty else {
            return nil
        }
        guard let components = URLComponents(string: rawBaseUrl),
              let scheme = components.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              let host = components.host else {
            return rawBaseUrl
        }
        var normalized = URLComponents()
        normalized.scheme = scheme
        normalized.host = host
        normalized.port = components.port
        return normalized.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? rawBaseUrl
    }

    private func apiUrl(path: String) -> URL? {
        guard let baseUrl = baseUrl,
              let components = URLComponents(string: baseUrl),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }
        return URL(string: baseUrl + path)
    }

    private func baseUrlDetail() -> [String: Any] {
        guard let baseUrl = baseUrl, !baseUrl.isEmpty else {
            return ["configured": false, "usable": false]
        }
        let scheme = URLComponents(string: baseUrl)?.scheme?.lowercased() ?? ""
        return [
            "configured": true,
            "scheme": scheme,
            "usable": scheme == "http" || scheme == "https",
            "baseUrl": baseUrl
        ]
    }

    private func multipartBody(boundary: String, wavData: Data) -> Data {
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"mimeType\"\r\n\r\n".data(using: .utf8)!)
        body.append("audio/wav\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"native-agent.wav\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wavData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return body
    }

    private func wavData(samples: [Int16], sampleRate: Double) -> Data {
        var data = Data()
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let sampleRateValue = UInt32(sampleRate)
        let byteRate = sampleRateValue * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)
        let subchunk2Size = UInt32(samples.count * MemoryLayout<Int16>.size)
        let chunkSize = 36 + subchunk2Size

        data.append("RIFF".data(using: .ascii)!)
        data.append(littleEndian(chunkSize))
        data.append("WAVEfmt ".data(using: .ascii)!)
        data.append(littleEndian(UInt32(16)))
        data.append(littleEndian(UInt16(1)))
        data.append(littleEndian(channels))
        data.append(littleEndian(sampleRateValue))
        data.append(littleEndian(byteRate))
        data.append(littleEndian(blockAlign))
        data.append(littleEndian(bitsPerSample))
        data.append("data".data(using: .ascii)!)
        data.append(littleEndian(subchunk2Size))
        for sample in samples {
            data.append(littleEndian(UInt16(bitPattern: sample)))
        }
        return data
    }

    private func littleEndian<T: FixedWidthInteger>(_ value: T) -> Data {
        var little = value.littleEndian
        return Data(bytes: &little, count: MemoryLayout<T>.size)
    }

    private func notifyTranscript(text: String?, provider: String?, error: String?) {
        var payload: [String: Any] = ["voiceSessionId": currentSessionId ?? ""]
        if let text = text { payload["text"] = text }
        if let provider = provider { payload["provider"] = provider }
        if let error = error { payload["error"] = error }
        notifyListeners("voiceTranscript", data: payload)
    }

    private func statusPayload() -> [String: Any] {
        return [
            "active": active,
            "state": state.rawValue,
            "backgroundCapable": true,
            "audioSessionActive": active,
            "pendingChunks": uploadInFlight ? 1 : 0,
            "currentTurnId": currentSessionId ?? "",
            "lastError": lastError ?? NSNull(),
            "engineRunning": audioEngine.isRunning,
            "audioPlaying": audioPlayer?.isPlaying ?? false,
            "speechSpeaking": speechSynthesizer.isSpeaking,
            "lastAudioBufferAt": lastAudioBufferAt ?? NSNull(),
            "applicationState": currentApplicationStateName()
        ]
    }

    private func audioSessionDetail() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        return [
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "sampleRate": session.sampleRate,
            "inputAvailable": session.isInputAvailable,
            "engineRunning": audioEngine.isRunning,
            "applicationState": currentApplicationStateName(),
            "lastAudioBufferAt": lastAudioBufferAt ?? NSNull()
        ]
    }

    private func notifyDiagnostic(_ event: String, detail: [String: Any]) {
        notifyListeners("voiceSessionDiagnostic", data: [
            "voiceSessionId": currentSessionId ?? "",
            "event": event,
            "detail": detail,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ])
    }
}
`;

const BRIDGE_SOURCE = String.raw`import Capacitor
import UIKit

class CrewCmdBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CrewCmdVoiceSessionPlugin())
    }
}
`;

const metadata = {
  pluginName: "CrewCmdVoiceSession",
  swiftFile: path.join("ios", "App", "App", pluginFilename),
  bridgeFile: path.join("ios", "App", "App", bridgeFilename),
  methods: ["isAvailable", "start", "stop", "muteMic", "playAudio", "speakText", "stopAudio", "status"],
  events: ["voiceLevel", "voiceSessionDiagnostic", "voiceTranscript"],
  phase: "native-engine-transcription-upload",
};

function addSwiftSourceToProject(project, filename, fileRefId, buildFileId) {
  if (hasSwiftSourceInProject(project, filename)) {
    return project;
  }
  project = project.replace(
    "/* Begin PBXBuildFile section */\n",
    `/* Begin PBXBuildFile section */\n\t\t${buildFileId} /* ${filename} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${filename} */; };\n`,
  );
  project = project.replace(
    "/* Begin PBXFileReference section */\n",
    `/* Begin PBXFileReference section */\n\t\t${fileRefId} /* ${filename} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${filename}; sourceTree = "<group>"; };\n`,
  );
  project = project.replace(
    /(\t\t\t\t504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,[\n\r]+)/,
    `$1\t\t\t\t${fileRefId} /* ${filename} */,\n`,
  );
  project = project.replace(
    /(\t\t\t\t504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,[\n\r]+)/,
    `$1\t\t\t\t${buildFileId} /* ${filename} in Sources */,\n`,
  );
  return project;
}

function hasSwiftSourceInProject(project, filename) {
  return (
    project.includes(`/* ${filename} */ = {isa = PBXFileReference`) &&
    project.includes(`/* ${filename} in Sources */ = {isa = PBXBuildFile`) &&
    project.includes(`/* ${filename} */,`) &&
    project.includes(`/* ${filename} in Sources */,`)
  );
}

function ensureProjectFile() {
  if (!fs.existsSync(projectPath)) {
    return false;
  }

  let project = fs.readFileSync(projectPath, "utf8");
  project = addSwiftSourceToProject(project, pluginFilename, "CCVS000000000000000001", "CCVS000000000000000002");
  project = addSwiftSourceToProject(project, bridgeFilename, "CCVB000000000000000001", "CCVB000000000000000002");

  fs.writeFileSync(projectPath, project);
  return hasSwiftSourceInProject(project, pluginFilename) && hasSwiftSourceInProject(project, bridgeFilename);
}

function ensureNativeSources() {
  if (!fs.existsSync(iosAppDir)) {
    return false;
  }
  fs.writeFileSync(pluginPath, PLUGIN_SOURCE);
  fs.writeFileSync(bridgePath, BRIDGE_SOURCE);
  return true;
}

function ensureInfoPlistMicrophoneUsage() {
  if (!fs.existsSync(infoPlistPath)) {
    return false;
  }

  let plist = fs.readFileSync(infoPlistPath, "utf8");
  if (plist.includes("<key>NSMicrophoneUsageDescription</key>")) {
    return true;
  }

  plist = plist.replace(
    /<\/dict>/,
    "	<key>NSMicrophoneUsageDescription</key>\n	<string>CrewCmd uses the microphone for hands-free agent voice mode.</string>\n</dict>",
  );
  fs.writeFileSync(infoPlistPath, plist);
  return plist.includes("<key>NSMicrophoneUsageDescription</key>");
}

function ensureStoryboardBridgeController() {
  if (!fs.existsSync(storyboardPath)) {
    return false;
  }

  let storyboard = fs.readFileSync(storyboardPath, "utf8");
  if (storyboard.includes('customClass="CrewCmdBridgeViewController"')) {
    return true;
  }

  storyboard = storyboard.replace(
    /customClass="CAPBridgeViewController"(?: customModule="[^"]+")?/,
    'customClass="CrewCmdBridgeViewController" customModule="App"',
  );

  fs.writeFileSync(storyboardPath, storyboard);
  return storyboard.includes('customClass="CrewCmdBridgeViewController"');
}

const sourceApplied = ensureNativeSources();
const projectApplied = sourceApplied ? ensureProjectFile() : false;
const storyboardApplied = sourceApplied ? ensureStoryboardBridgeController() : false;
const microphoneUsageApplied = sourceApplied ? ensureInfoPlistMicrophoneUsage() : false;

fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, "ios-voice-session.json"),
  `${JSON.stringify(
    {
      ...metadata,
      applied: {
        swiftSource: sourceApplied,
        xcodeProject: projectApplied,
        storyboard: storyboardApplied,
        microphoneUsageDescription: microphoneUsageApplied,
      },
    },
    null,
    2,
  )}\n`,
);

if (sourceApplied && projectApplied && storyboardApplied && microphoneUsageApplied) {
  console.log("Ensured iOS CrewCmdVoiceSession native plugin.");
} else if (sourceApplied) {
  console.log("Wrote iOS CrewCmdVoiceSession plugin source; Xcode project was not found or not patched.");
} else {
  console.log("No iOS native project found; wrote requested iOS voice-session metadata only.");
}
