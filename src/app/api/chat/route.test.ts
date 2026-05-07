import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

const mockGetGatewayClient = vi.fn();
const mockHoldClient = vi.fn();
const mockReleaseClient = vi.fn();
vi.mock("@/lib/gateway-chat-pool", () => ({
  getGatewayClient: (...args: unknown[]) => mockGetGatewayClient(...args),
  holdClient: (...args: unknown[]) => mockHoldClient(...args),
  releaseClient: (...args: unknown[]) => mockReleaseClient(...args),
}));

vi.mock("@/db", () => ({
  db: null,
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatMessages: Symbol("chatMessages"),
  chatSessions: Symbol("chatSessions"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("@/lib/chat-pubsub", () => ({
  publishChatEvent: vi.fn(),
}));

const mockSelectRecoveredAssistantText = vi.fn<(params: unknown) => string>(() => "");
vi.mock("@/lib/chat-recovery", () => ({
  selectRecoveredAssistantText: (params: unknown) => mockSelectRecoveredAssistantText(params),
}));

const mockPublishAgentModeDiagnostic = vi.fn();
vi.mock("@/lib/agent-mode-diagnostics", () => ({
  createAgentModeSessionId: vi.fn(() => "diag-chat-route"),
  publishAgentModeDiagnostic: (...args: unknown[]) => mockPublishAgentModeDiagnostic(...args),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(new URL("/api/chat", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function readFirstChunk(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let output = "";
  for (let i = 0; i < 3; i++) {
    const { value } = await reader.read();
    output += decoder.decode(value);
  }
  await reader.cancel();
  return output;
}

async function readUntilDone(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let output = "";

  for (let i = 0; i < 10 && !output.includes("data: [DONE]"); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

async function readUntilContains(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string,
  maxReads = 10,
) {
  const decoder = new TextDecoder();
  let output = "";

  for (let i = 0; i < maxReads && !output.includes(text); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockSelectRecoveredAssistantText.mockReturnValue("");
    mockGetGatewayClient.mockResolvedValue({
      on: vi.fn(),
      off: vi.fn(),
      chatSend: vi.fn(() => new Promise(() => {})),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an SSE response before gateway chatSend resolves", async () => {
    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const firstChunk = await readFirstChunk(response);
    expect(firstChunk).toContain("event: chat_progress");
    expect(firstChunk).toContain("\"event\":\"run_started\"");
    expect(firstChunk).toContain("gateway_send_started");
    expect(firstChunk).toContain("sessionKey");
  });

  it("starts the gateway send asynchronously after opening the stream", async () => {
    const chatSend = vi.fn(() => new Promise(() => {}));
    const chatAbort = vi.fn(() => Promise.resolve());
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn(),
      off: vi.fn(),
      chatSend,
      chatAbort,
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();

    await reader.read();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetGatewayClient).toHaveBeenCalledTimes(1);
    expect(chatSend).toHaveBeenCalledWith({
      message: "hello",
      sessionKey: "main",
    });

    await reader.cancel();
    expect(chatAbort).not.toHaveBeenCalled();
  });

  it("passes low thinking only for scoped agent mode sends", async () => {
    const chatSend = vi.fn(() => new Promise(() => {}));
    const chatAbort = vi.fn(() => Promise.resolve());
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn(),
      off: vi.fn(),
      chatSend,
      chatAbort,
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      agentMode: true,
    }));
    const reader = response.body!.getReader();

    await reader.read();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatSend).toHaveBeenCalledWith({
      message: "hello",
      sessionKey: "main",
      thinking: "low",
    });

    await reader.cancel();
  });

  it("streams structured progress events alongside OpenAI-compatible text deltas", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    const chatSend = vi.fn().mockResolvedValue({ runId: "run-1" });
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend,
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    const chatHandler = chatHandlers[0];
    chatHandler({
      state: "delta",
      sessionKey: "main",
      runId: "run-1",
      message: { content: "hi" },
    });
    chatHandler({
      stream: "status",
      sessionKey: "main",
      runId: "run-1",
      data: { label: "Shelling", phase: "start", detail: "searching files" },
    });
    chatHandler({
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { content: "hi there" },
    });

    const streamed = first + await readUntilDone(reader);

    expect(streamed).toContain("event: chat_progress");
    expect(streamed).toContain("\"event\":\"run_started\"");
    expect(streamed).toContain("\"event\":\"gateway_send_started\"");
    expect(streamed).toContain("\"event\":\"tool_updated\"");
    expect(streamed).toContain("\"name\":\"Shelling\"");
    expect(streamed).toContain("\"event\":\"run_completed\"");
    expect(streamed).toContain("\"type\":\"gateway_send_started\"");
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"hi\"}}]");
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\" there\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("streams wildcard tool progress while gateway chatSend is still pending", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    const chatSend = vi.fn(() => new Promise(() => {}));
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend,
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "inspect files" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const initial = await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "tool_call",
      sessionKey: "main",
      data: {
        type: "tool_call",
        name: "read",
        status: "started",
        input: { path: "AGENTS.md" },
      },
    });

    const next = await readUntilContains(reader, "\"event\":\"tool_started\"");

    expect(initial).toContain("\"event\":\"gateway_send_started\"");
    expect(next).toContain("\"event\":\"tool_started\"");
    expect(next).toContain("\"name\":\"read\"");
    expect(next).toContain("AGENTS.md");

    await reader.cancel();
  });

  it("streams compaction checkpoints as progress events", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    const chatSend = vi.fn(() => new Promise(() => {}));
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend,
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "inspect files" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "context.compacted",
      sessionKey: "main",
      data: {
        checkpointId: "ctx-1",
        title: "Compacted history",
        summary: "Earlier turns were preserved in a checkpoint.",
      },
    });

    const next = await readUntilContains(reader, "\"event\":\"history_compacted\"");

    expect(next).toContain("\"event\":\"history_compacted\"");
    expect(next).toContain("\"title\":\"Compacted history\"");
    expect(next).toContain("\"id\":\"ctx-1\"");
    expect(next).toContain("Earlier turns were preserved");

    await reader.cancel();
  });

  it("does not finish the chat stream for non-chat agent tool finals", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "inspect files" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const first = await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "agent",
      runId: "run-1",
      stream: "tool",
      state: "final",
      sessionKey: "main",
      data: {
        name: "exec",
        status: "completed",
        output: "build passed",
      },
    });

    const toolFrame = await readUntilContains(reader, "\"event\":\"tool_completed\"");
    expect(first).toContain("\"event\":\"gateway_send_started\"");
    expect(toolFrame).toContain("\"event\":\"tool_completed\"");
    expect(toolFrame).toContain("\"name\":\"exec\"");
    expect(toolFrame).not.toContain("data: [DONE]");

    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { content: "actual answer" },
    });

    const streamed = await readUntilDone(reader);
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"actual answer\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("keeps waiting when a chat final has no assistant text after tool activity", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn().mockResolvedValue({ messages: [] }),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "inspect files" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const first = await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "agent",
      runId: "run-1",
      stream: "tool",
      sessionKey: "main",
      data: {
        phase: "start",
        name: "exec",
        args: { command: "pnpm test" },
      },
    });

    const toolFrame = await readUntilContains(reader, "\"event\":\"tool_started\"");
    expect(first).toContain("\"event\":\"gateway_send_started\"");
    expect(toolFrame).toContain("\"event\":\"tool_started\"");

    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { content: "" },
    });

    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { content: "actual answer" },
    });

    const streamed = await readUntilDone(reader);
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"actual answer\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("finishes after deferred tool completion when history later has assistant text", async () => {
    vi.useFakeTimers();
    try {
      const chatHandlers: Array<(payload: unknown) => void> = [];
      const chatHistory = vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: "inspect files" },
          { role: "assistant", content: "late answer" },
        ],
      });
      mockSelectRecoveredAssistantText.mockReturnValue("late answer");
      mockGetGatewayClient.mockResolvedValueOnce({
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
          if (event === "*") chatHandlers.push(handler);
        }),
        off: vi.fn(),
        chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
        chatAbort: vi.fn(() => Promise.resolve()),
        chatHistory,
        rpc: vi.fn().mockResolvedValue({ sessions: [] }),
      });

      const response = await POST(makeRequest({
        messages: [{ role: "user", content: "inspect files" }],
        agent: "main",
      }));
      const reader = response.body!.getReader();
      await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

      await vi.waitFor(() => {
        expect(chatHandlers).toHaveLength(1);
      });

      chatHandlers[0]({
        event: "agent",
        runId: "run-1",
        stream: "tool",
        sessionKey: "main",
        data: {
          phase: "start",
          name: "exec",
          args: { command: "pnpm test" },
        },
      });
      await readUntilContains(reader, "\"event\":\"tool_started\"");

      chatHandlers[0]({
        event: "chat",
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { content: "" },
      });

      await vi.advanceTimersByTimeAsync(0);
      const streamed = await readUntilDone(reader);

      expect(chatHistory).toHaveBeenCalledWith({ sessionKey: "main", limit: 25 });
      expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"late answer\"}}]");
      expect(streamed).toContain("\"event\":\"run_completed\"");
      expect(streamed).toContain("data: [DONE]");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not finish or stream tool-result chat finals as assistant answers", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn().mockResolvedValue({ messages: [] }),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "inspect files" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: {
        role: "tool_result",
        content: "raw tool output that should not become the assistant answer",
      },
    });

    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { role: "assistant", content: "human-facing answer" },
    });

    const streamed = await readUntilDone(reader);
    expect(streamed).not.toContain("raw tool output");
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"human-facing answer\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("keeps long-running chat streams alive with heartbeat progress", async () => {
    vi.useFakeTimers();
    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "keep working" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let initial = "";
    for (let i = 0; i < 3; i++) {
      const { value } = await reader.read();
      initial += decoder.decode(value);
    }
    expect(initial).toContain("\"event\":\"run_started\"");
    expect(initial).toContain("\"event\":\"gateway_send_started\"");

    await vi.advanceTimersByTimeAsync(30_000);
    const heartbeat = decoder.decode((await reader.read()).value);

    expect(heartbeat).toContain("event: chat_progress");
    expect(heartbeat).toContain("\"event\":\"heartbeat\"");

    await reader.cancel();
  });

  it("finishes as aborted when the gateway reports an aborted turn", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend: vi.fn().mockResolvedValue({ runId: "run-abort" }),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "stop if cancelled" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      state: "delta",
      sessionKey: "main",
      runId: "run-abort",
      message: { content: "partial answer" },
    });
    chatHandlers[0]({
      state: "aborted",
      sessionKey: "main",
      runId: "run-abort",
    });

    const streamed = first + await readUntilDone(reader);

    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"partial answer\"}}]");
    expect(streamed).toContain("\"event\":\"run_aborted\"");
    expect(streamed).toContain("data: [DONE]");
  });

  it("ignores stale chat events from a previously selected session or agent", async () => {
    const chatHandlers: Array<(payload: unknown) => void> = [];
    mockGetGatewayClient.mockResolvedValueOnce({
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === "*") chatHandlers.push(handler);
      }),
      off: vi.fn(),
      chatSend: vi.fn().mockResolvedValue({ runId: "run-active" }),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "active agent only" }],
      agent: "neo",
      gatewayAgent: "neo",
      sessionKey: "neo:active-session",
    }));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    const chatHandler = chatHandlers[0];
    chatHandler({
      state: "delta",
      sessionKey: "cipher:previous-session",
      runId: "run-stale",
      message: { content: "stale output" },
    });
    chatHandler({
      state: "delta",
      sessionKey: "neo:active-session",
      runId: "run-active",
      message: { content: "fresh output" },
    });
    chatHandler({
      state: "final",
      sessionKey: "neo:active-session",
      runId: "run-active",
      message: { content: "fresh output done" },
    });

    const streamed = first + await readUntilDone(reader);

    expect(streamed).not.toContain("stale output");
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"fresh output\"}}]");
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\" done\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("polls active chat history and streams sparse assistant progress", async () => {
    vi.useFakeTimers();
    try {
      mockSelectRecoveredAssistantText.mockReturnValue("from history");
      const chatHandlers: Array<(payload: unknown) => void> = [];
      const chatHistory = vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "from history" },
        ],
      });
      mockGetGatewayClient.mockResolvedValueOnce({
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
          if (event === "*") chatHandlers.push(handler);
        }),
        off: vi.fn(),
        chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
        chatAbort: vi.fn(() => Promise.resolve()),
        chatHistory,
        rpc: vi.fn().mockResolvedValue({ sessions: [] }),
      });

      const response = await POST(makeRequest({
        messages: [{ role: "user", content: "hello" }],
        agent: "main",
      }));
      const reader = response.body!.getReader();

      const first = new TextDecoder().decode((await reader.read()).value);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(chatHistory).toHaveBeenCalledWith({ sessionKey: "main", limit: 25 });
        expect(chatHandlers).toHaveLength(1);
      });
      await Promise.resolve();
      await Promise.resolve();

      chatHandlers[0]({
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { content: "" },
      });
      const streamed = first + await readUntilDone(reader);

      expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"from history\"}}]");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not log optional chat history RPC timeouts as API errors", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const chatHandlers: Array<(payload: unknown) => void> = [];
      const chatHistory = vi.fn().mockRejectedValue(new Error("RPC timeout: chat.history"));
      mockGetGatewayClient.mockResolvedValueOnce({
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
          if (event === "*") chatHandlers.push(handler);
        }),
        off: vi.fn(),
        chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
        chatAbort: vi.fn(() => Promise.resolve()),
        chatHistory,
        rpc: vi.fn().mockResolvedValue({ sessions: [] }),
      });

      const response = await POST(makeRequest({
        messages: [{ role: "user", content: "hello" }],
        agent: "main",
      }));
      const reader = response.body!.getReader();

      await reader.read();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(chatHistory).toHaveBeenCalledWith({ sessionKey: "main", limit: 25 });
        expect(chatHandlers).toHaveLength(1);
      });

      chatHandlers[0]({
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { content: "" },
      });
      await readUntilDone(reader);

      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Failed to poll chat history"),
        expect.any(Error),
      );
      expect(mockPublishAgentModeDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "history-poll.timeout",
          detail: { sessionKey: "main" },
        }),
      );
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("stops active history polling after a terminal chat event", async () => {
    vi.useFakeTimers();
    try {
      mockSelectRecoveredAssistantText.mockReturnValue("from history");
      const chatHandlers: Array<(payload: unknown) => void> = [];
      const chatHistory = vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "from history" },
        ],
      });
      mockGetGatewayClient.mockResolvedValueOnce({
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
          if (event === "*") chatHandlers.push(handler);
        }),
        off: vi.fn(),
        chatSend: vi.fn().mockResolvedValue({ runId: "run-1" }),
        chatAbort: vi.fn(() => Promise.resolve()),
        chatHistory,
        rpc: vi.fn().mockResolvedValue({ sessions: [] }),
      });

      const response = await POST(makeRequest({
        messages: [{ role: "user", content: "hello" }],
        agent: "main",
      }));
      const reader = response.body!.getReader();

      await reader.read();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(chatHistory).toHaveBeenCalledTimes(1);
        expect(chatHandlers).toHaveLength(1);
      });

      chatHandlers[0]({
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { content: "from history complete" },
      });
      await readUntilDone(reader);
      await vi.advanceTimersByTimeAsync(1_500);

      expect(chatHistory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
