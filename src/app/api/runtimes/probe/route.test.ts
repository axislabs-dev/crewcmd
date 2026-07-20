import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockProbeGateway } = vi.hoisted(() => ({
  mockProbeGateway: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: vi.fn(async () => null),
}));

vi.mock("@/lib/gateway-client", () => ({
  probeGateway: (...args: unknown[]) => mockProbeGateway(...args),
  resolveDeviceIdentity: vi.fn(() => ({
    deviceId: "device-1",
    publicKeyRawBase64Url: "public-key",
    privateKeyPem: "private-key",
    source: "configured",
  })),
}));

vi.mock("@/lib/openclaw-config-parser", () => ({
  parseOpenClawConfig: vi.fn(),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/runtimes/probe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/runtimes/probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubEnv("AUTH_SECRET", "runtime-probe-device-auth-test-secret");
  });

  it("probes Hermes runtimes through the HTTP API", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "hermes-agent", name: "Hermes Agent" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ object: "hermes.api_server.capabilities" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeRequest({
      runtimeType: "hermes",
      url: "http://localhost:8642/v1",
      token: "secret",
      name: "Local Hermes",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      defaultAgentId: "hermes-agent",
      agents: [
        {
          id: "hermes-agent",
          name: "Local Hermes",
          title: "Hermes Agent",
          model: "hermes-agent",
        },
      ],
      models: [{ id: "hermes-agent", name: "Hermes Agent", provider: "hermes" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/health", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/models", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
    expect(mockProbeGateway).not.toHaveBeenCalled();
  });

  it("preserves OpenClaw gateway probe behavior", async () => {
    mockProbeGateway.mockResolvedValue({
      ok: true,
      agents: [],
      models: [],
    });

    const response = await POST(makeRequest({
      mode: "gateway",
      url: "localhost:18789",
      token: "openclaw-token",
    }));

    expect(response.status).toBe(200);
    expect(mockProbeGateway).toHaveBeenCalledWith("ws://localhost:18789", "openclaw-token", undefined);
  });

  it("seals issued device credentials before returning probe data to the browser", async () => {
    mockProbeGateway.mockResolvedValue({
      ok: true,
      version: "2026.7.1",
      agents: [],
      models: [],
      devicePrivateKeyPem: "plaintext-private-key",
      deviceAuth: {
        token: "plaintext-device-token",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
    });

    const response = await POST(makeRequest({
      mode: "gateway",
      url: "localhost:18789",
      token: "openclaw-token",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty("deviceAuth");
    expect(payload.devicePrivateKeyPem).toMatch(/^crewcmd:runtime-token:v1:/);
    expect(payload.runtimeAuthMetadata).toMatchObject({
      devicePrivateKeyPem: payload.devicePrivateKeyPem,
      openclawDeviceAuth: {
        version: 1,
        deviceId: "device-1",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("plaintext-private-key");
    expect(JSON.stringify(payload)).not.toContain("plaintext-device-token");
  });

  it("seals a pending pairing identity so retries use the same device safely", async () => {
    mockProbeGateway.mockResolvedValue({
      ok: false,
      error: "pairing_required",
      pairingInstructions: "Approve this device",
      agents: [],
      models: [],
      devicePrivateKeyPem: "plaintext-private-key",
    });

    const response = await POST(makeRequest({
      mode: "gateway",
      url: "localhost:18789",
      token: "openclaw-token",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: false,
      pairingRequired: true,
      pairingInstructions: "Approve this device",
    });
    expect(payload.devicePrivateKeyPem).toMatch(/^crewcmd:runtime-token:v1:/);
    expect(JSON.stringify(payload)).not.toContain("plaintext-private-key");
  });
});
