import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realtimeClientMocks = vi.hoisted(() => ({
  cancelRealtimeRelayOutput: vi.fn(),
  openRealtimeRelayEvents: vi.fn(),
  sendRealtimeRelayAudio: vi.fn(),
  sendRealtimeRelayMark: vi.fn(),
  sendRealtimeRelayToolCall: vi.fn(),
  sendRealtimeRelayToolResult: vi.fn(),
  stopRealtimeRelay: vi.fn(),
}));

vi.mock("./realtime-voice-client", () => realtimeClientMocks);

import {
  buildRealtimeVoiceContext,
  clearRealtimeVoiceContextForTest,
  DESKTOP_REALTIME_BARGE_IN_PROFILE,
  MOBILE_REALTIME_BARGE_IN_PROFILE,
  RealtimeGatewayRelaySession,
  detectRealtimeBargeIn,
  recordRealtimeVoiceContext,
  resolveRealtimeBargeInProfile,
  withRealtimeScreenContext,
} from "./realtime-voice-gateway-relay";
import { usePageContextStore } from "./page-context-store";

class FakeRelayEventSource {
  private listeners = new Map<string, (event: { data: string }) => void>();
  onerror: (() => void) | null = null;
  close = vi.fn();

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }

  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }
}

function createMediaStream() {
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function installAudioContext() {
  let processor: {
    onaudioprocess: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  } | null = null;

  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    close = vi.fn();

    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }

    createScriptProcessor() {
      processor = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() };
      return processor;
    }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);
  return () => processor;
}

describe("realtime gateway relay lifecycle", () => {
  beforeEach(() => {
    for (const mock of Object.values(realtimeClientMocks)) mock.mockReset();
    realtimeClientMocks.sendRealtimeRelayAudio.mockResolvedValue(undefined);
    realtimeClientMocks.stopRealtimeRelay.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves provider failures that arrive before microphone access resolves", async () => {
    const eventSource = new FakeRelayEventSource();
    realtimeClientMocks.openRealtimeRelayEvents.mockReturnValue(eventSource as unknown as EventSource);
    const { stream, track } = createMediaStream();
    let resolveMedia!: (media: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolveMedia = resolve;
    }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, userAgent: "desktop" });
    const onStatus = vi.fn();
    const onError = vi.fn();
    const relay = new RealtimeGatewayRelaySession(
      "rt_1",
      { relaySessionId: "relay_1", transport: "gateway-relay" },
      { onStatus, onError },
    );

    const starting = relay.start();
    eventSource.emit("realtime_relay", {
      relaySessionId: "relay_1",
      type: "error",
      message: "Unexpected server response: 500",
    });

    await expect(starting).rejects.toThrow("Unexpected server response: 500");
    resolveMedia(stream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());

    expect(onError).toHaveBeenCalledWith("Unexpected server response: 500");
    expect(onStatus).toHaveBeenLastCalledWith("error", "Unexpected server response: 500");
    expect(onStatus).not.toHaveBeenCalledWith("listening");
    expect(realtimeClientMocks.sendRealtimeRelayAudio).not.toHaveBeenCalled();
    expect(realtimeClientMocks.stopRealtimeRelay).toHaveBeenCalledWith("rt_1", "relay_1");
    expect(eventSource.close).toHaveBeenCalledOnce();
  });

  it("stops the microphone pump after the first audio relay failure", async () => {
    const eventSource = new FakeRelayEventSource();
    realtimeClientMocks.openRealtimeRelayEvents.mockReturnValue(eventSource as unknown as EventSource);
    realtimeClientMocks.sendRealtimeRelayAudio.mockRejectedValueOnce(new Error("Unknown Talk session"));
    const { stream, track } = createMediaStream();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      userAgent: "desktop",
    });
    const readProcessor = installAudioContext();
    const onStatus = vi.fn();
    const onError = vi.fn();
    const relay = new RealtimeGatewayRelaySession(
      "rt_1",
      { relaySessionId: "relay_1", transport: "gateway-relay" },
      { onStatus, onError },
    );

    const starting = relay.start();
    eventSource.emit("realtime_relay", { relaySessionId: "relay_1", type: "ready" });
    await starting;
    const processor = readProcessor();
    expect(processor?.onaudioprocess).toBeTypeOf("function");

    const audioEvent = {
      inputBuffer: { getChannelData: () => new Float32Array([0.1, -0.1]) },
    };
    processor?.onaudioprocess?.(audioEvent);
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith("error", "Unknown Talk session"));
    processor?.onaudioprocess?.(audioEvent);

    expect(realtimeClientMocks.sendRealtimeRelayAudio).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("Unknown Talk session");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(realtimeClientMocks.stopRealtimeRelay).toHaveBeenCalledWith("rt_1", "relay_1");
    expect(eventSource.close).toHaveBeenCalledOnce();
  });
});

function inputWithLevel(level: number) {
  return new Float32Array([level, -level, level, -level]);
}

describe("realtime gateway relay barge-in detection", () => {
  it("requires sustained desktop speech before barge-in", () => {
    let speechFrames = 0;
    for (let i = 0; i < DESKTOP_REALTIME_BARGE_IN_PROFILE.frames; i += 1) {
      const result = detectRealtimeBargeIn({
        input: inputWithLevel(0.11),
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

  it("does not trigger mobile barge-in during the output grace window", () => {
    const result = detectRealtimeBargeIn({
      input: inputWithLevel(0.3),
      activeOutput: true,
      cancelRequested: false,
      speechFrames: 0,
      outputStartedAtMs: 1_000,
      nowMs: 1_200,
      profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
    });

    expect(result).toEqual({ triggered: false, speechFrames: 1, suppressInput: false });
  });

  it("requires sustained stronger speech before mobile barge-in", () => {
    let speechFrames = 0;
    for (let i = 0; i < MOBILE_REALTIME_BARGE_IN_PROFILE.frames - 1; i += 1) {
      const result = detectRealtimeBargeIn({
        input: inputWithLevel(0.23),
        activeOutput: true,
        cancelRequested: false,
        speechFrames,
        outputStartedAtMs: 1_000,
        nowMs: 2_500,
        profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
      });
      speechFrames = result.speechFrames;
      expect(result.triggered).toBe(false);
    }

    const result = detectRealtimeBargeIn({
      input: inputWithLevel(0.23),
      activeOutput: true,
      cancelRequested: false,
      speechFrames,
      outputStartedAtMs: 1_000,
      nowMs: 2_500,
      profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
    });

    expect(result.triggered).toBe(true);
    expect(result.suppressInput).toBe(false);
  });

  it("keeps likely mobile speech audible while waiting to confirm barge-in", () => {
    let speechFrames = 0;
    for (let i = 0; i < MOBILE_REALTIME_BARGE_IN_PROFILE.frames - 2; i += 1) {
      const result = detectRealtimeBargeIn({
        input: inputWithLevel(0.3),
        activeOutput: true,
        cancelRequested: false,
        speechFrames,
        outputStartedAtMs: 1_000,
        nowMs: 2_500,
        profile: MOBILE_REALTIME_BARGE_IN_PROFILE,
      });
      speechFrames = result.speechFrames;
      expect(result.triggered).toBe(false);
      expect(result.suppressInput).toBe(false);
    }
  });

  it("suppresses mobile playback echo until likely speech starts", () => {
    const echo = detectRealtimeBargeIn({
      input: inputWithLevel(0.04),
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
