import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openRealtimeRelayEvents,
  sendRealtimeRelayAudio,
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
    })).resolves.toEqual({ transport: "gateway-relay", relaySessionId: "relay_1" });

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

  it("opens relay events for the selected runtime and session", () => {
    const eventSourceMock = vi.fn();
    vi.stubGlobal("EventSource", eventSourceMock);

    openRealtimeRelayEvents("rt_1", "relay 1");

    expect(eventSourceMock).toHaveBeenCalledWith(
      "/api/runtimes/rt_1/talk/realtime/events?relaySessionId=relay+1",
    );
  });
});
