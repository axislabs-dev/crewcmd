import { describe, expect, it } from "vitest";
import { resolveRuntimeAgentAdapterConfig } from "./runtime-agent-credentials";

describe("resolveRuntimeAgentAdapterConfig", () => {
  it("replaces persisted runtime credentials with the current runtime token", () => {
    const stored = {
      url: "https://runtime.example",
      headers: {
        authorization: "Bearer stale-secret",
        "X-OpenClaw-Token": "stale-openclaw-secret",
        "X-Trace-Mode": "enabled",
      },
      timeoutSec: 30,
    };

    expect(resolveRuntimeAgentAdapterConfig(stored, "current-secret")).toEqual({
      url: "https://runtime.example",
      headers: {
        "X-Trace-Mode": "enabled",
        Authorization: "Bearer current-secret",
      },
      timeoutSec: 30,
    });
    expect(stored.headers.authorization).toBe("Bearer stale-secret");
  });

  it("fails closed by removing persisted runtime credentials when no token exists", () => {
    expect(resolveRuntimeAgentAdapterConfig({
      url: "https://runtime.example",
      headers: {
        Authorization: "Bearer stale-secret",
        "x-openclaw-token": "stale-openclaw-secret",
      },
    }, null)).toEqual({
      url: "https://runtime.example",
    });
  });

  it("adds runtime authentication without persisting or mutating the source config", () => {
    const stored = { url: "https://runtime.example", sessionKey: "session-1" };
    const resolved = resolveRuntimeAgentAdapterConfig(stored, "runtime-secret");

    expect(resolved).toEqual({
      url: "https://runtime.example",
      sessionKey: "session-1",
      headers: { Authorization: "Bearer runtime-secret" },
    });
    expect(stored).not.toHaveProperty("headers");
  });
});
