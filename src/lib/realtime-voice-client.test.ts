import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelRealtimeRelayOutput,
  getRealtimeVoiceReadiness,
  openRealtimeRelayEvents,
  resolveRealtimeVoiceSessionIdentity,
  resolveRealtimeVoiceSessionSettings,
  sendRealtimeRelayAudio,
  sendRealtimeRelayToolCall,
  startRealtimeVoiceSession,
} from "./realtime-voice-client";

describe("realtime voice client helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads server-derived readiness before opening a microphone", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        readiness: {
          status: "ready",
          provider: "openai",
          transport: "gateway-relay",
          fallback: "classic-stt-tts",
          availableTransports: ["gateway-relay"],
          protocolVerified: true,
          message: "Ready",
        },
      }),
    } as Response);

    await expect(getRealtimeVoiceReadiness({
      runtimeId: "rt 1",
      provider: "openai",
    })).resolves.toMatchObject({ status: "ready", provider: "openai" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtimes/rt%201/talk/realtime/session?provider=openai",
      { headers: { Accept: "application/json" } },
    );
  });

  it("surfaces a denied microphone without requesting media", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "denied" }),
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        readiness: {
          status: "ready",
          provider: "openai",
          transport: "gateway-relay",
          fallback: "classic-stt-tts",
          availableTransports: ["gateway-relay"],
          protocolVerified: true,
          message: "Ready",
        },
      }),
    } as Response);

    await expect(getRealtimeVoiceReadiness({ runtimeId: "rt_1" })).resolves.toMatchObject({
      status: "microphone-denied",
      message: expect.stringContaining("Allow microphone access"),
    });
    expect(navigator.permissions.query).toHaveBeenCalledOnce();
  });

  it("normalizes failed readiness requests to an actionable state", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(getRealtimeVoiceReadiness({ runtimeId: "rt_1" })).resolves.toMatchObject({
      status: "unreachable",
      fallback: "classic-stt-tts",
    });
  });

  it("starts sessions through the runtime realtime talk route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: { transport: "gateway-relay", relaySessionId: "relay_1" } }),
    } as Response);

    await expect(startRealtimeVoiceSession({
      runtimeId: "rt 1",
      sessionKey: "main",
      provider: "openai",
    })).resolves.toEqual({ transport: "gateway-relay", relaySessionId: "relay_1", sessionKey: "main" });

    expect(fetchMock).toHaveBeenCalledWith("/api/runtimes/rt%201/talk/realtime/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKey: "main",
        provider: "openai",
        model: undefined,
        voice: undefined,
        agentId: undefined,
      }),
    });
  });

  it("sends channel scope for realtime channel agent mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: { transport: "gateway-relay", relaySessionId: "relay_1" } }),
    } as Response);

    await startRealtimeVoiceSession({
      runtimeId: "rt_1",
      sessionKey: "main",
      agentId: "main",
      channelId: "channel_crew",
      channelAgentId: "neo",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/runtimes/rt_1/talk/realtime/session", expect.objectContaining({
      body: JSON.stringify({
        sessionKey: "main",
        agentId: "main",
        channelId: "channel_crew",
        channelAgentId: "neo",
      }),
    }));
  });

  it("sends relay audio through the runtime relay route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { ok: true } }),
    } as Response);

    await sendRealtimeRelayAudio("rt_1", {
      relaySessionId: "relay_1",
      audioBase64: "AAAA",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/runtimes/rt_1/talk/realtime/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "audio",
        relaySessionId: "relay_1",
        audioBase64: "AAAA",
      }),
    });
  });

  it("sends output cancellation through the runtime relay route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { ok: true } }),
    } as Response);

    await cancelRealtimeRelayOutput("rt_1", "relay_1", "barge-in");

    expect(fetchMock).toHaveBeenCalledWith("/api/runtimes/rt_1/talk/realtime/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancelOutput",
        relaySessionId: "relay_1",
        reason: "barge-in",
      }),
    });
  });

  it("sends provider tool calls through the runtime relay route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { delegated: true } }),
    } as Response);

    await sendRealtimeRelayToolCall("rt_1", {
      relaySessionId: "relay_1",
      sessionKey: "main",
      callId: "call_1",
      name: "openclaw_agent_consult",
      args: { prompt: "Inspect this repo" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/runtimes/rt_1/talk/realtime/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toolCall",
        relaySessionId: "relay_1",
        sessionKey: "main",
        callId: "call_1",
        name: "openclaw_agent_consult",
        args: { prompt: "Inspect this repo" },
      }),
    });
  });

  it("opens relay events for the selected runtime and session", () => {
    const eventSourceMock = vi.fn();
    vi.stubGlobal("EventSource", eventSourceMock);

    openRealtimeRelayEvents("rt_1", "relay 1");

    expect(eventSourceMock).toHaveBeenCalledWith(
      "/api/runtimes/rt_1/talk/realtime/events?relaySessionId=relay+1",
    );
  });

  it("maps OpenAI voice selections to realtime session settings", () => {
    expect(resolveRealtimeVoiceSessionSettings({
      enabled: true,
      provider: "openai",
      voiceId: "cedar",
      model: "gpt-realtime-1.5",
    })).toEqual({
      provider: "openai",
      voice: "cedar",
      model: "gpt-realtime-1.5",
    });
  });

  it("changes the realtime session identity only for session-scoped voice settings", () => {
    const cedar = resolveRealtimeVoiceSessionIdentity({
      enabled: true,
      provider: "openai",
      voiceId: "cedar",
      speed: 1,
    });

    expect(resolveRealtimeVoiceSessionIdentity({
      enabled: true,
      provider: "openai",
      voiceId: "marin",
      speed: 1,
    })).not.toBe(cedar);
    expect(resolveRealtimeVoiceSessionIdentity({
      enabled: true,
      provider: "openai",
      voiceId: "cedar",
      speed: 1.2,
    })).toBe(cedar);
  });

  it("maps Google voice selections to realtime session settings", () => {
    expect(resolveRealtimeVoiceSessionSettings({
      enabled: true,
      provider: "google",
      voiceId: "Kore",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
    })).toEqual({
      provider: "google",
      voice: "Kore",
      model: "gemini-2.5-flash-native-audio-preview-12-2025",
    });
  });

  it("does not forward non-realtime TTS voice settings", () => {
    expect(resolveRealtimeVoiceSessionSettings({
      enabled: true,
      provider: "elevenlabs",
      voiceId: "eleven_voice",
    })).toEqual({});
    expect(resolveRealtimeVoiceSessionSettings({
      enabled: true,
      provider: "openai",
      voiceId: "onyx",
      model: "tts-1",
    })).toEqual({
      provider: "openai",
      voice: undefined,
      model: undefined,
    });
  });
});
