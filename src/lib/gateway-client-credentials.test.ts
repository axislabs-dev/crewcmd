import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, type DeviceIdentity } from "./gateway-client";
import { sealRuntimeAuthToken } from "./runtime-token-crypto";

const device: DeviceIdentity = {
  deviceId: "device_1",
  publicKeyRawBase64Url: "pub",
  privateKeyPem: "private",
  source: "configured",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GatewayClient runtime credentials", () => {
  it("decrypts stored ciphertext once at the server-side client boundary", () => {
    vi.stubEnv("AUTH_SECRET", "gateway-client-test-secret");
    const stored = sealRuntimeAuthToken("openclaw-token");
    const client = new GatewayClient("ws://localhost:18789", stored, device);

    expect((client as unknown as { authToken: string | null }).authToken).toBe(
      "openclaw-token",
    );
  });

  it("preserves ephemeral and legacy plaintext tokens during migration", () => {
    const client = new GatewayClient("ws://localhost:18789", "probe-token", device);

    expect((client as unknown as { authToken: string | null }).authToken).toBe("probe-token");
  });
});
