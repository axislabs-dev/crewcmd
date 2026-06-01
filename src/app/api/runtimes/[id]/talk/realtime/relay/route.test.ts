import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  ownerUserId: string | null;
};
type ChatSessionRow = {
  id: string;
  agentId: string;
  companyId: string | null;
  channelId: string | null;
  gatewaySessionKey: string | null;
  updatedAt: Date;
};

type Field = { key: string };
type Predicate<T = RuntimeRow> = (row: T) => boolean;

const {
  mockRuntimeRows,
  mockChatSessionRows,
  mockGetGatewayClientForRuntime,
  mockHoldClient,
  mockReleaseClient,
  mockCanAccessChatSession,
  mockPersistChatProgressEvent,
  mockPublishChatProgressEvent,
} = vi.hoisted(() => ({
  mockRuntimeRows: [] as RuntimeRow[],
  mockChatSessionRows: [] as ChatSessionRow[],
  mockGetGatewayClientForRuntime: vi.fn(),
  mockHoldClient: vi.fn(),
  mockReleaseClient: vi.fn(),
  mockCanAccessChatSession: vi.fn(),
  mockPersistChatProgressEvent: vi.fn(),
  mockPublishChatProgressEvent: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    id: { key: "id" },
    ownerUserId: { key: "ownerUserId" },
  },
  chatSessions: {
    id: { key: "id" },
    gatewaySessionKey: { key: "gatewaySessionKey" },
    updatedAt: { key: "updatedAt" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate<Record<string, unknown>> => (row) => row[field.key] === value,
  and: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.every((predicate) => predicate?.(row) ?? true),
  desc: (field: Field) => field,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: Predicate) => ({
          orderBy: () => ({
            limit: (count: number) => Promise.resolve(
              mockChatSessionRows
                .filter(predicate as unknown as Predicate<ChatSessionRow>)
                .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                .slice(0, count),
            ),
          }),
          limit: (count: number) => {
            const rows = isChatSessionsTable(table)
              ? mockChatSessionRows.filter(predicate as unknown as Predicate<ChatSessionRow>)
              : mockRuntimeRows.filter(predicate as unknown as Predicate<RuntimeRow>);
            return Promise.resolve(rows.slice(0, count));
          },
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

vi.mock("@/lib/chat-session-access", () => ({
  canAccessChatSession: (...args: unknown[]) => mockCanAccessChatSession(...args),
}));

vi.mock("@/lib/chat-session-events", () => ({
  persistChatProgressEvent: (...args: unknown[]) => mockPersistChatProgressEvent(...args),
}));

vi.mock("@/lib/chat-pubsub", () => ({
  publishChatProgressEvent: (...args: unknown[]) => mockPublishChatProgressEvent(...args),
}));

import { POST } from "./route";

function isChatSessionsTable(table: unknown) {
  return Boolean(table && typeof table === "object" && "gatewaySessionKey" in table);
}

describe("POST /api/runtimes/[id]/talk/realtime/relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeRows.length = 0;
    mockChatSessionRows.length = 0;
    mockCanAccessChatSession.mockResolvedValue(true);
    mockPersistChatProgressEvent.mockResolvedValue(undefined);
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

  it("publishes OpenClaw tool progress from realtime consults into the chat audit trail", async () => {
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
    mockChatSessionRows.push({
      id: "session_1",
      agentId: "neo",
      companyId: "company_1",
      channelId: "channel_1",
      gatewaySessionKey: "main",
      updatedAt: new Date(),
    });
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

    await vi.waitFor(() => expect(gatewayHandler).toBeTypeOf("function"));

    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "tool_call",
      runId: "run_1",
      status: "started",
      data: {
        toolCallId: "tool_1",
        name: "exec",
        args: { command: "find /Users/roger/Developer -maxdepth 4 -name README.md" },
      },
    });
    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "tool",
      runId: "run_1",
      status: "completed",
      data: {
        toolCallId: "tool_1",
        name: "exec",
        output: "README.md",
      },
    });
    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "chat",
      runId: "run_1",
      state: "final",
      message: { content: [{ type: "text", text: "The repo is a CrewCMD app." }] },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const persistedEvents = mockPersistChatProgressEvent.mock.calls.map((call) => call[0].payload.event);
    expect(persistedEvents).toContain("run_started");
    expect(persistedEvents).toContain("tool_started");
    expect(persistedEvents).toContain("tool_completed");
    expect(persistedEvents).toContain("run_completed");
    expect(mockPublishChatProgressEvent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session_1",
      agentId: "neo",
      companyId: "company_1",
      sessionKey: "main",
      channelId: "channel_1",
      event: "tool_started",
      payload: expect.objectContaining({
        runId: "run_1",
        activeTool: expect.objectContaining({
          id: "tool_1",
          name: "exec",
          detailKind: "input",
        }),
      }),
    }));
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

  it("recovers empty final realtime consult events from chat history", async () => {
    let gatewayHandler: ((payload: unknown) => void) | null = null;
    const client = {
      realtimeClientToolCall: vi.fn().mockResolvedValue({ ok: true, runId: "run_1" }),
      realtimeRelayToolResult: vi.fn().mockResolvedValue({ ok: true }),
      chatHistory: vi.fn().mockResolvedValue({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Inspect this repo" }],
          },
          {
            role: "assistant",
            idempotencyKey: "run_1",
            content: [{ type: "text", text: "Recovered from the durable transcript." }],
          },
        ],
      }),
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

    await vi.waitFor(() => expect(gatewayHandler).toBeTypeOf("function"));

    (gatewayHandler as ((payload: unknown) => void) | null)?.({
      event: "chat",
      runId: "run_1",
      state: "final",
      message: { role: "assistant", content: [] },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: {
        delegated: true,
        runId: "run_1",
        finalText: "Recovered from the durable transcript.",
        result: { ok: true },
      },
    });
    expect(client.chatHistory).toHaveBeenCalledWith({ sessionKey: "main", limit: 25 });
    expect(client.realtimeRelayToolResult).toHaveBeenNthCalledWith(2, {
      relaySessionId: "relay_1",
      callId: "call_1",
      result: { text: "Recovered from the durable transcript." },
    });
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
