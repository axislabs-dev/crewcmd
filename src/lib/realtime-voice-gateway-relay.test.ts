import { describe, expect, it } from "vitest";
import {
  buildRealtimeVoiceContext,
  clearRealtimeVoiceContextForTest,
  DESKTOP_REALTIME_BARGE_IN_PROFILE,
  MOBILE_REALTIME_BARGE_IN_PROFILE,
  detectRealtimeBargeIn,
  recordRealtimeVoiceContext,
  resolveRealtimeBargeInProfile,
  withRealtimeScreenContext,
} from "./realtime-voice-gateway-relay";
import { usePageContextStore } from "./page-context-store";

function inputWithLevel(level: number) {
  return new Float32Array([level, -level, level, -level]);
}

describe("realtime gateway relay barge-in detection", () => {
  it("keeps the existing desktop sensitivity", () => {
    let speechFrames = 0;
    for (let i = 0; i < DESKTOP_REALTIME_BARGE_IN_PROFILE.frames; i += 1) {
      const result = detectRealtimeBargeIn({
        input: inputWithLevel(0.09),
        activeOutput: true,
        cancelRequested: false,
        speechFrames,
        outputStartedAtMs: 0,
        nowMs: 100,
        profile: DESKTOP_REALTIME_BARGE_IN_PROFILE,
      });
      speechFrames = result.speechFrames;
      if (i === DESKTOP_REALTIME_BARGE_IN_PROFILE.frames - 1) {
        expect(result.triggered).toBe(true);
      }
    }
  });

  it("ignores mobile speaker echo during the output grace window", () => {
    const result = detectRealtimeBargeIn({
      input: inputWithLevel(0.3),
      activeOutput: true,
      cancelRequested: false,
      speechFrames: 0,
      outputStartedAtMs: 1_000,
      nowMs: 1_200,
      profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
    });

    expect(result).toEqual({ triggered: false, speechFrames: 0, suppressInput: true });
  });

  it("requires sustained stronger speech before mobile barge-in", () => {
    let speechFrames = 0;
    for (let i = 0; i < MOBILE_REALTIME_BARGE_IN_PROFILE.frames - 1; i += 1) {
      const result = detectRealtimeBargeIn({
        input: inputWithLevel(0.17),
        activeOutput: true,
        cancelRequested: false,
        speechFrames,
        outputStartedAtMs: 1_000,
        nowMs: 2_000,
        profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
      });
      speechFrames = result.speechFrames;
      expect(result.triggered).toBe(false);
    }

    const result = detectRealtimeBargeIn({
      input: inputWithLevel(0.17),
      activeOutput: true,
      cancelRequested: false,
      speechFrames,
      outputStartedAtMs: 1_000,
      nowMs: 2_000,
      profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
    });

    expect(result.triggered).toBe(true);
    expect(result.suppressInput).toBe(false);
  });

  it("suppresses mobile playback echo until barge-in is confirmed", () => {
    const echo = detectRealtimeBargeIn({
      input: inputWithLevel(0.08),
      activeOutput: true,
      cancelRequested: false,
      speechFrames: 0,
      outputStartedAtMs: 1_000,
      nowMs: 2_000,
      profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
    });
    const desktop = detectRealtimeBargeIn({
      input: inputWithLevel(0.08),
      activeOutput: true,
      cancelRequested: false,
      speechFrames: 0,
      outputStartedAtMs: 1_000,
      nowMs: 2_000,
      profile: DESKTOP_REALTIME_BARGE_IN_PROFILE,
    });

    expect(echo.suppressInput).toBe(true);
    expect(desktop.suppressInput).toBe(false);
  });

  it("uses the mobile profile for Capacitor and mobile user agents", () => {
    expect(resolveRealtimeBargeInProfile("Mozilla/5.0 (iPhone)", false)).toBe(MOBILE_REALTIME_BARGE_IN_PROFILE);
    expect(resolveRealtimeBargeInProfile("Mozilla/5.0 (Macintosh)", true)).toBe(MOBILE_REALTIME_BARGE_IN_PROFILE);
    expect(resolveRealtimeBargeInProfile("Mozilla/5.0 (Macintosh)", false)).toBe(DESKTOP_REALTIME_BARGE_IN_PROFILE);
  });
});

describe("realtime gateway relay screen context", () => {
  it("adds current CrewCMD page context to consult args", () => {
    usePageContextStore.getState().setContext({
      route: "/tasks",
      surface: "tasks",
      entityIds: { taskId: "task_1" },
      visibleIds: ["task_1", "task_2"],
      screenText: "Task detail Fix realtime voice Status review",
    });

    expect(withRealtimeScreenContext({
      question: "What is this?",
      context: "Existing context",
    })).toEqual({
      question: "What is this?",
      context: [
        "Existing context",
        "",
        "CrewCMD page context for this turn:",
        "Current CrewCMD surface: tasks",
        "Current route: /tasks",
        "Selected task ID: task_1",
        "Visible IDs: task_1, task_2",
        "Visible screen text:",
        "Task detail Fix realtime voice Status review",
      ].join("\n"),
    });

    usePageContextStore.getState().clearContext();
  });

  it("adds recent realtime voice context to consult args", () => {
    expect(withRealtimeScreenContext(
      { question: "What was I asking about?" },
      "Recent realtime voice context for this CrewCMD session:\nuser: Read the README",
    )).toEqual({
      question: "What was I asking about?",
      context: "Recent realtime voice context for this CrewCMD session:\nuser: Read the README",
    });
  });
});

describe("realtime gateway relay voice context", () => {
  it("keeps recent final voice turns by session", () => {
    clearRealtimeVoiceContextForTest();

    recordRealtimeVoiceContext("main", { role: "user", text: "Read the README", final: true });
    recordRealtimeVoiceContext("main", { role: "assistant", text: "I am checking it now.", final: false });
    recordRealtimeVoiceContext("main", { role: "assistant", text: "product-videogen is a video engine.", final: true });

    expect(buildRealtimeVoiceContext("main")).toBe([
      "Recent realtime voice context for this CrewCMD session:",
      "user: Read the README",
      "assistant: product-videogen is a video engine.",
    ].join("\n"));
    expect(buildRealtimeVoiceContext("other")).toBeNull();

    clearRealtimeVoiceContextForTest();
  });
});
