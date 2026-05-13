import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "apps/mobile/scripts/ensure-ios-voice-session.mjs");
const source = readFileSync(scriptPath, "utf8");

describe("iOS native voice-session generator", () => {
  it("does not hold a finite UIApplication background task for the full voice session", () => {
    expect(source).not.toContain("sessionBackgroundTask");
    expect(source).not.toContain("CrewCmdVoiceSession\") { [weak self] in");
    expect(source).not.toContain("native.session-background-task.expired");
  });

  it("only uses finite background tasks for upload completion work", () => {
    expect(source).toContain("CrewCmdVoiceUpload");
    expect(source).toContain("native.background-task.begin");
    expect(source).toContain("native.background-task.end");
  });

  it("updates watchdog buffer timestamps before active or muted VAD gates", () => {
    const bufferHandler = source.slice(
      source.indexOf("private func handleAudioBuffer"),
      source.indexOf("private func finishRecording")
    );

    expect(bufferHandler).toContain("lastAudioBufferAt = Date().timeIntervalSince1970 * 1000");
    expect(bufferHandler.indexOf("lastAudioBufferAt = Date().timeIntervalSince1970 * 1000")).toBeLessThan(
      bufferHandler.indexOf("guard active, !micMuted else { return }")
    );
  });

  it("uses the current hardware input format after route sample-rate changes", () => {
    const startEngine = source.slice(
      source.indexOf("private func startEngine"),
      source.indexOf("private func stopEngine")
    );
    const routeChangeHandler = source.slice(
      source.indexOf("private func handleAudioRouteChange"),
      source.indexOf("private func recoverAudioEngine")
    );
    const bufferHandler = source.slice(
      source.indexOf("private func handleAudioBuffer"),
      source.indexOf("private func finishRecording")
    );

    expect(startEngine).toContain("let inputFormat = input.inputFormat(forBus: 0)");
    expect(startEngine).toContain("let format = inputFormat.sampleRate > 0 && inputFormat.channelCount > 0 ? inputFormat : outputFormat");
    expect(startEngine).toContain("input.installTap(onBus: 0, bufferSize: 1024, format: format)");
    expect(startEngine).toContain("installKeepaliveInputGraph(input: input, format: format)");
    expect(startEngine).toContain("audioEngine.connect(input, to: keepaliveMixer, format: format)");
    expect(routeChangeHandler).toContain("let shouldRestart = shouldRestartForRouteChange(reason)");
    expect(routeChangeHandler).toContain('recoverAudioEngine(reason: "route-change", forceRestart: true)');
    expect(bufferHandler).toContain("recordingSampleRate = buffer.format.sampleRate");
    expect(bufferHandler).toContain("recordingChannels = Int(buffer.format.channelCount)");
  });

  it("uses native VAD timing that tolerates natural pauses and adaptive noise", () => {
    expect(source).toContain("private let baseSilenceThreshold = 0.006");
    expect(source).toContain("private let speechStartMs = 250.0");
    expect(source).toContain("private let silenceEndMs = 1800.0");
    expect(source).toContain("private let minRecordingMs = 600.0");
    expect(source).toContain("private func currentSilenceThreshold()");
    expect(source).toContain("noiseFloorRms * 3.0");
  });

  it("does not hard-restart the native engine for every route configuration change", () => {
    const routeChangeHandler = source.slice(
      source.indexOf("private func handleAudioRouteChange"),
      source.indexOf("private func recoverAudioEngine")
    );

    expect(routeChangeHandler).toContain("private func shouldRestartForRouteChange");
    expect(routeChangeHandler).toContain("case .routeConfigurationChange:");
    expect(routeChangeHandler).toContain('notifyDiagnostic("native.audio-session.route-change.coalesced"');
    expect(routeChangeHandler).toContain("try preferAvailableInput(AVAudioSession.sharedInstance())");
  });

  it("suppresses VAD recording while native playback is speaking", () => {
    const bufferHandler = source.slice(
      source.indexOf("private func handleAudioBuffer"),
      source.indexOf("private func finishRecording")
    );

    expect(source).toContain("private var playbackSuppressionUntil: TimeInterval = 0");
    expect(source).toContain("suppressRecordingForPlayback(tailMs: 2000)");
    expect(source).toContain("suppressRecordingForPlayback(tailMs: 2500)");
    expect(bufferHandler).toContain("guard now >= playbackSuppressionUntil else");
    expect(bufferHandler).toContain("resetRecording()");
  });

  it("prefers natural iOS speech voices over compact and novelty voices", () => {
    const voiceSelector = source.slice(
      source.indexOf("private func preferredSpeechVoice"),
      source.indexOf("private func suppressRecordingForPlayback")
    );

    expect(source).toContain("utterance.voice = self.preferredSpeechVoice(voiceId: voiceId, voiceName: voiceName, language: language)");
    expect(voiceSelector).toContain("if let exact = voices.first(where: { $0.identifier == voiceId && !isBlockedSpeechVoice($0) })");
    expect(voiceSelector).not.toContain("if let anyByName = voices.first(where: { $0.name.localizedCaseInsensitiveContains(voiceName) })");
    expect(voiceSelector).toContain('["Daniel", "Matilda", "Ava", "Zoe", "Samantha", "Karen", "Moira", "Serena", "Siri"]');
    expect(voiceSelector).toContain('identifier.contains("albert") || name.contains("albert")');
    expect(voiceSelector).toContain(".first { !isBlockedSpeechVoice($0) }");
    expect(voiceSelector).toContain('["en-AU", "en-US", "en-GB"]');
    expect(voiceSelector).toContain("isNaturalSpeechVoice($0)");
    expect(voiceSelector).toContain('"eloquence"');
    expect(voiceSelector).toContain('"compact"');
    expect(voiceSelector).toContain("$0.quality.rawValue > $1.quality.rawValue");
  });

  it("uploads foreground native recordings for transcription", () => {
    const finishRecording = source.slice(
      source.indexOf("private func finishRecording"),
      source.indexOf("private func resetRecording")
    );

    expect(finishRecording).not.toContain("native.recording.foreground-discarded");
    expect(finishRecording).not.toContain("guard appState != .active");
    expect(finishRecording).toContain("uploadWav(samples: samples, sampleRate: sampleRate)");
  });

  it("does not read UIKit application state from capture handlers", () => {
    const captureSections = [
      source.slice(source.indexOf("private func handleAudioSessionInterruption"), source.indexOf("private func handleAudioRouteChange")),
      source.slice(source.indexOf("private func handleAudioRouteChange"), source.indexOf("private func recoverAudioEngine")),
      source.slice(source.indexOf("private func recoverAudioEngine"), source.indexOf("private func startAudioWatchdog")),
      source.slice(source.indexOf("private func startAudioWatchdog"), source.indexOf("private func stopAudioWatchdog")),
      source.slice(source.indexOf("private func statusPayload"), source.indexOf("private func audioSessionDetail")),
      source.slice(source.indexOf("private func audioSessionDetail"), source.indexOf("private func notifyDiagnostic")),
    ];

    for (const section of captureSections) {
      expect(section).not.toContain("UIApplication.shared.applicationState");
      expect(section).toContain("currentApplicationStateName()");
    }
  });

  it("keeps cached app state current across active and inactive lifecycle events", () => {
    expect(source).toContain("UIApplication.didBecomeActiveNotification");
    expect(source).toContain("UIApplication.willResignActiveNotification");
    expect(source).toContain('notifyDiagnostic("native.app.active"');
    expect(source).toContain('notifyDiagnostic("native.app.inactive"');
  });

  it("registers the generated plugin with the Capacitor iOS bridge", () => {
    expect(source).toContain("CrewCmdBridgeViewController");
    expect(source).toContain("bridge?.registerPluginInstance(CrewCmdVoiceSessionPlugin())");
    expect(source).toContain("Main.storyboard");
    expect(source).toContain('customClass="CrewCmdBridgeViewController"');
  });
});
