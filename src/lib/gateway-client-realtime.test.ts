import { describe, expect, it, vi } from "vitest";
import { GatewayClient, type DeviceIdentity } from "./gateway-client";

const device: DeviceIdentity = {
  deviceId: "device_1",
  publicKeyRawBase64Url: "pub",
  privateKeyPem: "private",
  source: "configured",
};

describe("GatewayClient realtime Talk compatibility", () => {
  it("creates realtime talk sessions through the OpenClaw client Talk API", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc").mockResolvedValueOnce({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });

    await expect(client.realtimeTalkSession({
      sessionKey: "main",
      provider: "openai",
      agentId: "NEO",
    })).resolves.toMatchObject({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });

    expect(rpc).toHaveBeenCalledWith("talk.client.create", {
      sessionKey: "main",
      provider: "openai",
      agentId: "NEO",
    });
  });

  it("falls back to the unified Talk session API when client Talk create is unavailable", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc")
      .mockRejectedValueOnce(new Error("method not found"))
      .mockResolvedValueOnce({
        transport: "gateway-relay",
        relaySessionId: "relay_1",
      });

    await expect(client.realtimeTalkSession({
      sessionKey: "main",
      provider: "openai",
      agentId: "NEO",
    })).resolves.toMatchObject({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "talk.client.create", {
      sessionKey: "main",
      provider: "openai",
      agentId: "NEO",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "talk.session.create", {
      sessionKey: "main",
      provider: "openai",
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
    });
  });

  it("maps relay audio, tool results, and stop onto unified session methods", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ ok: true });

    await client.realtimeRelayAudio({
      relaySessionId: "relay_1",
      audioBase64: "AAAA",
      timestamp: 123,
    });
    await client.realtimeRelayToolResult({
      relaySessionId: "relay_1",
      callId: "call_1",
      result: { ok: true },
    });
    await client.realtimeRelayStop("relay_1");

    expect(rpc).toHaveBeenNthCalledWith(1, "talk.session.appendAudio", {
      sessionId: "relay_1",
      audioBase64: "AAAA",
      timestamp: 123,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "talk.session.submitToolResult", {
      sessionId: "relay_1",
      callId: "call_1",
      result: { ok: true },
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "talk.session.close", {
      sessionId: "relay_1",
    });
  });

  it("keeps relay mark acknowledgements local for the current OpenClaw API", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc");

    await expect(client.realtimeRelayMark({
      relaySessionId: "relay_1",
      markName: "done",
    })).resolves.toEqual({ ok: true });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps output cancellation onto the unified session API", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ ok: true });

    await expect(client.realtimeRelayCancelOutput("relay_1", "barge-in")).resolves.toEqual({ ok: true });

    expect(rpc).toHaveBeenCalledWith("talk.session.cancelOutput", {
      sessionId: "relay_1",
      reason: "barge-in",
    });
  });

  it("forwards realtime provider tool calls through OpenClaw client tool calls", async () => {
    const client = new GatewayClient("ws://localhost:18789", null, device);
    const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ runId: "run_1" });

    await expect(client.realtimeClientToolCall({
      sessionKey: "main",
      relaySessionId: "relay_1",
      callId: "call_1",
      name: "openclaw_agent_consult",
      args: { prompt: "Inspect this repo" },
    })).resolves.toEqual({ runId: "run_1" });

    expect(rpc).toHaveBeenCalledWith("talk.client.toolCall", {
      sessionKey: "main",
      relaySessionId: "relay_1",
      callId: "call_1",
      name: "openclaw_agent_consult",
      args: { prompt: "Inspect this repo" },
    });
  });
});
