import { describe, expect, it, vi } from "vitest";
import { GatewayClient, type DeviceIdentity } from "./gateway-client";

const device: DeviceIdentity = {
  deviceId: "device_1",
  publicKeyRawBase64Url: "pub",
  privateKeyPem: "private",
  source: "configured",
};

describe("GatewayClient realtime Talk compatibility", () => {
  it("creates gateway relay sessions through the unified Talk session API", async () => {
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

    expect(rpc).toHaveBeenCalledWith("talk.session.create", {
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
});
