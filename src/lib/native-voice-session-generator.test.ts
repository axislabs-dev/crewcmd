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

  it("registers the generated plugin with the Capacitor iOS bridge", () => {
    expect(source).toContain("CrewCmdBridgeViewController");
    expect(source).toContain("bridge?.registerPluginInstance(CrewCmdVoiceSessionPlugin())");
    expect(source).toContain("Main.storyboard");
    expect(source).toContain('customClass="CrewCmdBridgeViewController"');
  });
});
