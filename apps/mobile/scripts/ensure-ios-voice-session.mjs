import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const iosProjectDir = path.join(appDir, "ios", "App");
const iosAppDir = path.join(iosProjectDir, "App");
const projectPath = path.join(iosProjectDir, "App.xcodeproj", "project.pbxproj");
const pluginFilename = "CrewCmdVoiceSessionPlugin.swift";
const pluginPath = path.join(iosAppDir, pluginFilename);
const generatedDir = path.join(appDir, process.env.CREWCMD_MOBILE_OUTPUT_DIR || ".generated");

const PLUGIN_SOURCE = `import Foundation
import AVFoundation
import Capacitor

private enum CrewCmdVoiceState: String {
    case idle
    case listening
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
    private var lastError: String?
    private var lastLevel: Double = 0
    private var levelFrameCount = 0

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "platform": "ios",
            "backgroundCapable": true
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        let sessionId = call.getString("voiceSessionId") ?? UUID().uuidString
        currentSessionId = sessionId
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
            self.notifyDiagnostic("native.stop.completed", detail: [:])
            DispatchQueue.main.async {
                call.resolve(self.statusPayload())
            }
        }
    }

    @objc func muteMic(_ call: CAPPluginCall) {
        micMuted = call.getBool("muted") ?? false
        notifyDiagnostic("native.mute.changed", detail: ["muted": micMuted])
        call.resolve(statusPayload())
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
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.handleAudioBuffer(buffer)
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
        for index in 0..<frameLength {
            let sample = samples[index]
            sum += sample * sample
        }

        let rms = sqrt(sum / Float(frameLength))
        let normalized = min(Double(rms) * 10.0, 1.0)
        lastLevel = normalized
        levelFrameCount += 1

        // Emit roughly 5-8 updates/sec depending on hardware callback cadence.
        if levelFrameCount % 6 == 0 {
            notifyListeners("voiceLevel", data: [
                "voiceSessionId": currentSessionId ?? "",
                "level": normalized,
                "audioSessionActive": self.active,
                "backgroundCapable": true
            ])
        }
    }

    private func statusPayload() -> [String: Any] {
        return [
            "active": active,
            "state": state.rawValue,
            "backgroundCapable": true,
            "audioSessionActive": active,
            "pendingChunks": 0,
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
  events: ["voiceLevel", "voiceSessionDiagnostic"],
  phase: "native-engine-level-diagnostics",
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
