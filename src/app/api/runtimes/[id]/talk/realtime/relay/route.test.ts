import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  ownerUserId: string | null;
};

type Field = { key: keyof RuntimeRow };
type Predicate = (row: RuntimeRow) => boolean;

const { mockRuntimeRows, mockGetGatewayClientForRuntime, mockHoldClient, mockReleaseClient } = vi.hoisted(() => ({
  mockRuntimeRows: [] as RuntimeRow[],
  mockGetGatewayClientForRuntime: vi.fn(),
  mockHoldClient: vi.fn(),
  mockReleaseClient: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: { key: "id" },
    ownerUserId: { key: "ownerUserId" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
  and: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.every((predicate) => predicate?.(row) ?? true),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => ({
          limit: (count: number) => Promise.resolve(mockRuntimeRows.filter(predicate).slice(0, count)),
        }),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  getAgentAccessContext: () => ({ userId: "user_1", activeCompanyId: null, memberships: [] }),
  buildRuntimeReadWhere: () => (row: RuntimeRow) => row.ownerUserId === "user_1",
}));

vi.mock("@/lib/gateway-chat-pool", () => ({
  getGatewayClientForRuntime: (...args: unknown[]) => mockGetGatewayClientForRuntime(...args),
  holdClient: (...args: unknown[]) => mockHoldClient(...args),
  releaseClient: (...args: unknown[]) => mockReleaseClient(...args),
}));

import { POST } from "./route";

describe("POST /api/runtimes/[id]/talk/realtime/relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
  });

  it("proxies realtime relay audio chunks through an accessible runtime", async () => {
    const realtimeRelayAudio = vi.fn().mockResolvedValue({ ok: true });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeRelayAudio });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "audio",
          relaySessionId: "relay_1",
          audioBase64: "AAAA",
          timestamp: 123,
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { ok: true } });
    expect(realtimeRelayAudio).toHaveBeenCalledWith({
      relaySessionId: "relay_1",
      audioBase64: "AAAA",
      timestamp: 123,
    });
  });

  it("proxies realtime output cancellation through an accessible runtime", async () => {
    const realtimeRelayCancelOutput = vi.fn().mockResolvedValue({ ok: true });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeRelayCancelOutput });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "cancelOutput",
          relaySessionId: "relay_1",
          reason: "barge-in",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { ok: true } });
    expect(realtimeRelayCancelOutput).toHaveBeenCalledWith("relay_1", "barge-in");
  });

  it("delegates realtime tool calls to OpenClaw and keeps the relay waiting for the final result", async () => {
    let gatewayHandler: ((payload: unknown) => void) | null = null;
    const client = {
      realtimeClientToolCall: vi.fn().mockResolvedValue({ runId: "run_1" }),
      realtimeRelayToolResult: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") gatewayHandler = handler;
      }),
      off: vi.fn(),
    };
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue(client);

    const responsePromise = POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "toolCall",
          relaySessionId: "relay_1",
          sessionKey: "main",
          callId: "call_1",
          name: "openclaw_agent_consult",
          args: { prompt: "Inspect this repo" },
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    await vi.waitFor(() => {
      expect(client.realtimeClientToolCall).toHaveBeenCalledWith({
        relaySessionId: "relay_1",
        sessionKey: "main",
        callId: "call_1",
        name: "openclaw_agent_consult",
        args: { prompt: "Inspect this repo" },
      });
      expect(gatewayHandler).toBeTypeOf("function");
    });

    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "chat",
      runId: "run_1",
      state: "final",
      message: { content: [{ type: "text", text: "The repo is a CrewCMD app." }] },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: {
        delegated: true,
        runId: "run_1",
        finalText: "The repo is a CrewCMD app.",
        result: { ok: true },
      },
    });
    expect(client.realtimeRelayToolResult).toHaveBeenNthCalledWith(1, {
      relaySessionId: "relay_1",
      callId: "call_1",
      result: {
        status: "working",
        tool: "openclaw_agent_consult",
        message:
          "Tell the person briefly that you are checking, then wait for the final OpenClaw result before answering with the actual result.",
      },
      options: { willContinue: true },
    });
    expect(client.realtimeRelayToolResult).toHaveBeenNthCalledWith(2, {
      relaySessionId: "relay_1",
      callId: "call_1",
      result: { text: "The repo is a CrewCMD app." },
    });
    expect(mockHoldClient).toHaveBeenCalledWith(client);
    expect(mockReleaseClient).toHaveBeenCalledWith(client);
  });

  it("extracts final realtime consult text from OpenClaw trace artifacts", async () => {
    let gatewayHandler: ((payload: unknown) => void) | null = null;
    const client = {
      realtimeClientToolCall: vi.fn().mockResolvedValue({ ok: true, runId: "run_1" }),
      realtimeRelayToolResult: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") gatewayHandler = handler;
      }),
      off: vi.fn(),
    };
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue(client);

    const responsePromise = POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "toolCall",
          relaySessionId: "relay_1",
          sessionKey: "main",
          callId: "call_1",
          name: "openclaw_agent_consult",
          args: { prompt: "Inspect this repo" },
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    await vi.waitFor(() => {
      expect(client.realtimeClientToolCall).toHaveBeenCalledWith({
        relaySessionId: "relay_1",
        sessionKey: "main",
        callId: "call_1",
        name: "openclaw_agent_consult",
        args: { prompt: "Inspect this repo" },
      });
      expect(gatewayHandler).toBeTypeOf("function");
    });

    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "trace.artifacts",
      runId: "run_1",
      state: "completed",
      data: {
        assistantTexts: ["The README describes the ClutchCut content engine."],
      },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: {
        delegated: true,
        runId: "run_1",
        finalText: "The README describes the ClutchCut content engine.",
        result: { ok: true },
      },
    });
    expect(client.realtimeRelayToolResult).toHaveBeenNthCalledWith(2, {
      relaySessionId: "relay_1",
      callId: "call_1",
      result: { text: "The README describes the ClutchCut content engine." },
    });
    expect(mockReleaseClient).toHaveBeenCalledWith(client);
  });

  it("rejects invalid relay actions before calling the gateway", async () => {
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/relay", {
        method: "POST",
        body: JSON.stringify({
          action: "unknown",
          relaySessionId: "relay_1",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(400);
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
