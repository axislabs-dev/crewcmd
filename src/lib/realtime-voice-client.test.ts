import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelRealtimeRelayOutput,
  openRealtimeRelayEvents,
  sendRealtimeRelayAudio,
  sendRealtimeRelayToolCall,
  startRealtimeVoiceSession,
} from "./realtime-voice-client";

describe("realtime voice client helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
