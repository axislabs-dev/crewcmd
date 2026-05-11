import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const iosProjectDir = path.join(appDir, "ios", "App");
const iosAppDir = path.join(iosProjectDir, "App");
const projectPath = path.join(iosProjectDir, "App.xcodeproj", "project.pbxproj");
const pluginFilename = "CrewCmdVoiceSessionPlugin.swift";
const pluginPath = path.join(iosAppDir, pluginFilename);
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
public class CrewCmdVoiceSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CrewCmdVoiceSessionPlugin"
    public let jsName = "CrewCmdVoiceSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "muteMic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
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

    private let silenceThreshold = 0.015
    private let speechStartMs = 200.0
    private let silenceEndMs = 1600.0
    private let minRecordingMs = 500.0
    private let maxRecordingMs = 20000.0

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
        baseUrl = call.getString("baseUrl")
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
                    try self.configureAudioSession()
                    try self.startEngine()
                    self.active = true
                    self.state = .listening
                    self.notifyDiagnostic("native.engine.started", detail: self.audioSessionDetail())
                    DispatchQueue.main.async {
                        call.resolve(self.statusPayload())
                    }
                } catch {
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

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
        )
        try session.setActive(true)
        notifyDiagnostic("native.audio-session.configured", detail: audioSessionDetail())
    }

    private func startEngine() throws {
        if audioEngine.isRunning {
            return
        }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        recordingSampleRate = format.sampleRate
        recordingChannels = Int(format.channelCount)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.captureQueue.async {
                self?.handleAudioBuffer(buffer)
            }
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    private func stopEngine() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            lastError = error.localizedDescription
        }
        lastLevel = 0
    }

    private func handleAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard active, !micMuted else { return }
        guard let channelData = buffer.floatChannelData else { return }
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return }

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
                "audioSessionActive": self.active,
                "backgroundCapable": true
            ])
        }

        guard !uploadInFlight else { return }

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
        let appState = UIApplication.shared.applicationState
        guard appState != .active else {
            notifyDiagnostic("native.recording.foreground-discarded", detail: [
                "durationMs": recordingMs,
                "samples": recordingSamples.count,
                "applicationState": applicationStateName(appState)
            ])
            resetRecording()
            state = active ? .listening : .idle
            return
        }
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
        guard let baseUrl = baseUrl, let uploadToken = uploadToken, let url = URL(string: baseUrl + "/api/stt") else {
            uploadInFlight = false
            endBackgroundTask()
            lastError = "Native voice upload is not configured"
            state = active ? .listening : .idle
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

    private func sendChatMessage(_ text: String) {
        guard let baseUrl = baseUrl, let uploadToken = uploadToken, let url = URL(string: baseUrl + "/api/chat") else {
            notifyDiagnostic("native.chat.skipped", detail: ["reason": "chat upload is not configured"])
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
            "lastError": lastError ?? NSNull()
        ]
    }

    private func audioSessionDetail() -> [String: Any] {
        let session = AVAudioSession.sharedInstance()
        return [
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "sampleRate": session.sampleRate,
            "inputAvailable": session.isInputAvailable
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

const metadata = {
  pluginName: "CrewCmdVoiceSession",
  swiftFile: path.join("ios", "App", "App", pluginFilename),
  methods: ["isAvailable", "start", "stop", "muteMic", "status"],
  events: ["voiceLevel", "voiceSessionDiagnostic", "voiceTranscript"],
  phase: "native-engine-transcription-upload",
};

function ensureProjectFile() {
  if (!fs.existsSync(projectPath)) {
    return false;
  }

  let project = fs.readFileSync(projectPath, "utf8");
  if (project.includes(`${pluginFilename} in Sources`)) {
    return true;
  }

  const fileRefId = "CCVS000000000000000001";
  const buildFileId = "CCVS000000000000000002";

  project = project.replace(
    "/* Begin PBXBuildFile section */\n",
    `/* Begin PBXBuildFile section */\n\t\t${buildFileId} /* ${pluginFilename} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${pluginFilename} */; };\n`,
  );
  project = project.replace(
    "/* Begin PBXFileReference section */\n",
    `/* Begin PBXFileReference section */\n\t\t${fileRefId} /* ${pluginFilename} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${pluginFilename}; sourceTree = "<group>"; };\n`,
  );
  project = project.replace(
    /(\t\t\t\t504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,[\n\r]+)/,
    `$1\t\t\t\t${fileRefId} /* ${pluginFilename} */,\n`,
  );
  project = project.replace(
    /(\t\t\t\t504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,[\n\r]+)/,
    `$1\t\t\t\t${buildFileId} /* ${pluginFilename} in Sources */,\n`,
  );

  fs.writeFileSync(projectPath, project);
  return true;
}

function ensurePluginSource() {
  if (!fs.existsSync(iosAppDir)) {
    return false;
  }
  fs.writeFileSync(pluginPath, PLUGIN_SOURCE);
  return true;
}

const sourceApplied = ensurePluginSource();
const projectApplied = sourceApplied ? ensureProjectFile() : false;

fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, "ios-voice-session.json"),
  `${JSON.stringify(
    {
      ...metadata,
      applied: {
        swiftSource: sourceApplied,
        xcodeProject: projectApplied,
      },
    },
    null,
    2,
  )}\n`,
);

if (sourceApplied && projectApplied) {
  console.log("Ensured iOS CrewCmdVoiceSession native plugin.");
} else if (sourceApplied) {
  console.log("Wrote iOS CrewCmdVoiceSession plugin source; Xcode project was not found or not patched.");
} else {
  console.log("No iOS native project found; wrote requested iOS voice-session metadata only.");
}
