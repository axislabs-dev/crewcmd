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

  it("registers the generated plugin with the Capacitor iOS bridge", () => {
    expect(source).toContain("CrewCmdBridgeViewController");
    expect(source).toContain("bridge?.registerPluginInstance(CrewCmdVoiceSessionPlugin())");
    expect(source).toContain("Main.storyboard");
    expect(source).toContain('customClass="CrewCmdBridgeViewController"');
  });
});
