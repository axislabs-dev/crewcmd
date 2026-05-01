import { describe, expect, it, vi } from "vitest";
import {
  listGatewayHarnessSpecs,
  runGatewayReliabilityHarness,
  type GatewayHarnessClient,
} from "./gateway-reliability-harness";

function makeClient(overrides: Partial<GatewayHarnessClient> = {}) {
  return {
    connect: vi.fn().mockResolvedValue({ ok: true }),
    rpc: vi.fn().mockResolvedValue({ ok: true }),
    chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
    chatHistory: vi.fn().mockResolvedValue({ messages: [] }),
    configGet: vi.fn().mockResolvedValue({ hash: "hash-1", config: {} }),
    configPatch: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } satisfies GatewayHarnessClient;
}

describe("gateway reliability harness", () => {
  it("lists a non-writing CI profile by default", () => {
    const specs = listGatewayHarnessSpecs();

    expect(specs.map((spec) => spec.id)).toEqual([
      "connect",
      "sessions.list",
      "chat.send",
      "chat.history",
      "config.get",
      "skills.status",
    ]);
    expect(specs.every((spec) => spec.risk === "read")).toBe(true);
  });

  it("runs read gateway checks against a client", async () => {
    const client = makeClient();

    const results = await runGatewayReliabilityHarness(client, {
      sessionKey: "main",
      message: "probe",
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "connect", ok: true, skipped: false }),
      expect.objectContaining({ id: "sessions.list", ok: true, skipped: false }),
      expect.objectContaining({ id: "chat.send", ok: true, skipped: false }),
      expect.objectContaining({ id: "chat.history", ok: true, skipped: false }),
      expect.objectContaining({ id: "config.get", ok: true, skipped: false }),
      expect.objectContaining({ id: "skills.status", ok: true, skipped: false }),
    ]);
    expect(client.rpc).toHaveBeenCalledWith("sessions.list", {});
    expect(client.chatSend).toHaveBeenCalledWith({ message: "probe", sessionKey: "main" });
    expect(client.chatHistory).toHaveBeenCalledWith({ sessionKey: "main", limit: 25 });
    expect(client.configPatch).not.toHaveBeenCalled();
  });

  it("runs write checks only when explicitly requested", async () => {
    const client = makeClient();

    const results = await runGatewayReliabilityHarness(client, {
      includeWriteSpecs: true,
      specs: ["config.patch"],
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "config.patch", ok: true, skipped: false, risk: "write" }),
    ]);
    expect(client.configPatch).toHaveBeenCalledWith({
      patch: {},
      note: "CrewCmd gateway harness validation",
    });
  });

  it("captures per-check failures without stopping the harness", async () => {
    const client = makeClient({
      chatHistory: vi.fn().mockRejectedValue(new Error("history unavailable")),
    });

    const results = await runGatewayReliabilityHarness(client, {
      specs: ["chat.send", "chat.history", "config.get"],
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "chat.send", ok: true }),
      expect.objectContaining({
        id: "chat.history",
        ok: false,
        error: "history unavailable",
      }),
      expect.objectContaining({ id: "config.get", ok: true }),
    ]);
  });
});
