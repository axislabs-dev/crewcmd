import { describe, expect, it } from "vitest";
import { deriveRuntimeTrustSummary } from "./runtime-trust";

const now = new Date("2026-05-01T00:10:00.000Z");

describe("deriveRuntimeTrustSummary", () => {
  it("marks a connected runtime with fresh heartbeat and capabilities as healthy", () => {
    const summary = deriveRuntimeTrustSummary({
      gatewayUrl: "ws://localhost:18789",
      httpUrl: "http://localhost:18789",
      status: "connected",
      lastPing: "2026-05-01T00:09:30.000Z",
      metadata: { capabilitySnapshot: { detectedAt: "2026-05-01T00:09:00.000Z" } },
    }, { now });

    expect(summary).toMatchObject({
      level: "healthy",
      reasons: [],
      lastPingAt: "2026-05-01T00:09:30.000Z",
      staleSeconds: 30,
      hasCapabilitySnapshot: true,
    });
  });

  it("marks stale or unconfirmed runtimes as degraded without blocking read access", () => {
    const summary = deriveRuntimeTrustSummary({
      gatewayUrl: "ws://localhost:18789",
      httpUrl: "http://localhost:18789",
      status: "unknown",
      lastPing: "2026-05-01T00:00:00.000Z",
      metadata: {},
    }, { now });

    expect(summary.level).toBe("degraded");
    expect(summary.reasons.map((reason) => reason.code)).toEqual([
      "status_unknown",
      "stale_last_ping",
      "missing_capability_snapshot",
    ]);
  });

  it("marks missing or invalid gateway configuration as untrusted", () => {
    const summary = deriveRuntimeTrustSummary({
      gatewayUrl: "not a url",
      httpUrl: "ftp://localhost/runtime",
      status: "disconnected",
      lastPing: null,
      metadata: null,
    }, { now });

    expect(summary.level).toBe("untrusted");
    expect(summary.reasons.map((reason) => reason.code)).toEqual([
      "invalid_gateway_url",
      "invalid_http_url",
      "status_disconnected",
      "missing_last_ping",
      "missing_capability_snapshot",
    ]);
  });
});
