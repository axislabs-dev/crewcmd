import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

const mockGetGatewayClient = vi.fn();
const mockHoldClient = vi.fn();
const mockReleaseClient = vi.fn();
const mockAssertPrimaryRuntimeInvocationAllowedForContext = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/gateway-chat-pool", () => ({
  getGatewayClient: (...args: unknown[]) => mockGetGatewayClient(...args),
  holdClient: (...args: unknown[]) => mockHoldClient(...args),
  releaseClient: (...args: unknown[]) => mockReleaseClient(...args),
}));

vi.mock("@/lib/runtime-scope-guard", () => ({
  assertPrimaryRuntimeInvocationAllowedForContext: (...args: unknown[]) => mockAssertPrimaryRuntimeInvocationAllowedForContext(...args),
}));

const mockResolveAccessibleWorkspace = vi.fn().mockResolvedValue({ id: "workspace-1", companyId: "company-1" });
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

vi.mock("@/db", () => ({
  db: null,
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatMessages: Symbol("chatMessages"),
  chatRuns: Symbol("chatRuns"),
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
  isAssistantDeliveryPlaceholder: (content: string) =>
    content.trim().replace(/\s+/g, " ").toLowerCase() === "answered in chat.",
  selectRecoveredAssistantText: (params: unknown) => mockSelectRecoveredAssistantText(params),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: vi.fn(() => null),
}));

vi.mock("@/lib/mobile-push", () => ({
  sendAgentReplyNotification: vi.fn(),
}));

const mockPublishAgentModeDiagnostic = vi.fn();
vi.mock("@/lib/agent-mode-diagnostics", () => ({
  createAgentModeSessionId: vi.fn(() => "diag-chat-route"),
  publishAgentModeDiagnostic: (...args: unknown[]) => mockPublishAgentModeDiagnostic(...args),
}));

import { PolicyViolation } from "@/lib/collaboration-policy";
import { POST } from "./route";

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/chat", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
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
    mockAssertPrimaryRuntimeInvocationAllowedForContext.mockResolvedValue(undefined);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "workspace-1", companyId: "company-1" });
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


  it("rejects chat persistence scope the caller cannot access", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      companyId: "other-company",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitCompanyId: "other-company",
      explicitWorkspaceId: null,
      requireExplicitForBearer: true,
    }));
    expect(mockAssertPrimaryRuntimeInvocationAllowedForContext).not.toHaveBeenCalled();
    expect(mockGetGatewayClient).not.toHaveBeenCalled();
  });

  it("keeps explicit personal workspace scope when the company cookie is stale", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce({
      id: "workspace-personal",
      companyId: null,
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      companyId: null,
      workspaceId: "workspace-personal",
    }, {
      Cookie: "active_company=company-stale; active_workspace=workspace-personal",
    }));

    expect(response.status).toBe(200);
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitCompanyId: null,
      explicitWorkspaceId: "workspace-personal",
      requireExplicitForBearer: true,
    }));
    expect(mockAssertPrimaryRuntimeInvocationAllowedForContext).toHaveBeenCalledWith(expect.objectContaining({
      companyId: null,
      workspaceId: "workspace-personal",
    }));

    await readFirstChunk(response);
  });

  it("keeps explicit company scope when the workspace cookie is stale", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce({
      id: "workspace-company",
      companyId: "company-1",
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      companyId: "company-1",
    }, {
      Cookie: "active_company=company-1; active_workspace=workspace-personal-stale",
    }));

    expect(response.status).toBe(200);
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitCompanyId: "company-1",
      explicitWorkspaceId: null,
      requireExplicitForBearer: true,
    }));
    expect(mockAssertPrimaryRuntimeInvocationAllowedForContext).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      workspaceId: "workspace-company",
    }));

    await readFirstChunk(response);
  });

  it("rejects conflicting explicit company and workspace scopes", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce({
      id: "workspace-personal",
      companyId: null,
    });

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      companyId: "company-1",
      workspaceId: "workspace-personal",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockAssertPrimaryRuntimeInvocationAllowedForContext).not.toHaveBeenCalled();
    expect(mockGetGatewayClient).not.toHaveBeenCalled();
  });

  it("rejects shared-context chat when the selected OpenClaw runtime is personal", async () => {
    mockAssertPrimaryRuntimeInvocationAllowedForContext.mockRejectedValueOnce(new PolicyViolation({
      allowed: false,
      code: "runtime_class_scope_mismatch",
      reason: "Personal runtimes cannot be bound to shared collaborative scopes.",
    }));

    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
      companyId: "company-1",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Personal runtimes cannot be bound to shared collaborative scopes.",
      code: "runtime_class_scope_mismatch",
    });
    expect(mockGetGatewayClient).not.toHaveBeenCalled();
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

  it("adds parent context to threaded chat sends", async () => {
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
      messages: [{ role: "user", content: "Can you expand on that?" }],
      agent: "main",
      sessionKey: "main:thread:parent-1",
      threadContext: {
        parentSessionKey: "main",
        threadSessionKey: "main:thread:parent-1",
        parentMessage: {
          role: "assistant",
          content: "The build failed because the API returned 500.",
        },
        contextMessages: [
          { role: "user", content: "How did the build go?" },
          { role: "assistant", content: "The build failed because the API returned 500." },
        ],
      },
    }));
    const reader = response.body!.getReader();

    await reader.read();
    await Promise.resolve();
    await Promise.resolve();

    const sent = (chatSend.mock.calls as unknown[][])[0]?.[0] as { message: string } | undefined;
    expect(sent).toBeDefined();
    expect(chatSend).toHaveBeenCalledWith({
      message: expect.stringContaining("CrewCMD threaded reply."),
      sessionKey: "main:thread:parent-1",
    });
    expect(sent!.message).toContain("Parent session: main");
    expect(sent!.message).toContain("Parent assistant message:");
    expect(sent!.message).toContain("Nearby prior context:");
    expect(sent!.message).toContain("User thread reply:");

    await reader.cancel();
  });

  it("preserves OpenClaw thread session keys that do not start with the callsign", async () => {
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
      messages: [{ role: "user", content: "Received" }],
      agent: "neo",
      gatewayAgent: "neo",
      sessionKey: "agent:main:neo:thread:agent-main-neo-history-43",
      threadContext: {
        parentSessionKey: "agent:main:neo",
        threadSessionKey: "agent:main:neo:thread:agent-main-neo-history-43",
        parentMessage: {
          role: "assistant",
          content: "Three things to focus on.",
        },
      },
    }));
    const reader = response.body!.getReader();

    await reader.read();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatSend).toHaveBeenCalledWith({
      message: expect.stringContaining("CrewCMD threaded reply."),
      sessionKey: "agent:main:neo:thread:agent-main-neo-history-43",
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

  it("keeps waiting when a chat final has no assistant text before any tool activity", async () => {
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
      messages: [{ role: "user", content: "how did it go?" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    const first = await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

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

    const streamed = first + await readUntilDone(reader);
    expect(streamed).toContain("\"event\":\"gateway_send_started\"");
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

  it("streams message-tool source replies instead of the delivery placeholder", async () => {
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
      messages: [{ role: "user", content: "did it publish?" }],
      agent: "main",
    }));
    const reader = response.body!.getReader();
    await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

    await vi.waitFor(() => {
      expect(chatHandlers).toHaveLength(1);
    });

    chatHandlers[0]({
      event: "agent",
      stream: "tool",
      sessionKey: "main",
      runId: "run-1",
      data: {
        name: "message",
        phase: "completed",
        result: {
          status: "ok",
          sourceReply: {
            text: "Detailed answer from the message tool.",
          },
        },
      },
    });
    chatHandlers[0]({
      event: "chat",
      state: "final",
      sessionKey: "main",
      runId: "run-1",
      message: { role: "assistant", content: "Answered in chat." },
    });

    const streamed = await readUntilDone(reader);
    expect(streamed).toContain("\"choices\":[{\"delta\":{\"content\":\"Detailed answer from the message tool.\"}}]");
    expect(streamed).not.toContain("\"choices\":[{\"delta\":{\"content\":\"Answered in chat.\"}}]");
    expect(streamed).toContain("data: [DONE]");
  });

  it("recovers Dashboard-mirrored message tool replies when chat final is only Done", async () => {
    vi.useFakeTimers();
    try {
      const chatHandlers: Array<(payload: unknown) => void> = [];
      let historyMessages: unknown[] = [];
      const chatHistory = vi.fn().mockImplementation(() => Promise.resolve({ messages: historyMessages }));
      mockSelectRecoveredAssistantText.mockImplementation((params: unknown) => {
        const messages = (params as { messages?: Array<{ role: string | null; content: string }> }).messages ?? [];
        expect(messages.some((message) => message.role === "assistant" && message.content === "Done.")).toBe(false);
        return messages.find((message) =>
          message.role === "assistant" &&
          message.content.includes("product-videogen")
        )?.content ?? "";
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
        messages: [{ role: "user", content: "Can you summarize the product-videogen README?" }],
        agent: "main",
      }));
      const reader = response.body!.getReader();
      await readUntilContains(reader, "\"event\":\"gateway_send_started\"");

      await vi.waitFor(() => {
        expect(chatHandlers).toHaveLength(1);
      });
      await vi.advanceTimersByTimeAsync(0);

      chatHandlers[0]({
        event: "agent",
        stream: "tool",
        sessionKey: "main",
        runId: "run-1",
        data: {
          name: "message",
          phase: "completed",
          result: { status: "ok" },
        },
      });
      await readUntilContains(reader, "\"event\":\"tool_completed\"");

      historyMessages = [
        { role: "user", content: "Can you summarize the product-videogen README?" },
        {
          role: "assistant",
          content: [{
            type: "text",
            text:
              "The README describes product-videogen as a workflow for creating product videos from prompts and assets.",
          }],
          openclawMessageToolMirror: { toolName: "message" },
        },
        { role: "assistant", content: "Done." },
      ];
      chatHandlers[0]({
        event: "chat",
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { role: "assistant", content: "Done." },
      });

      await vi.advanceTimersByTimeAsync(0);
      const streamed = await readUntilDone(reader);
      expect(streamed).toContain(
        "\"choices\":[{\"delta\":{\"content\":\"The README describes product-videogen as a workflow for creating product videos from prompts and assets.\"}}]",
      );
      expect(streamed).not.toContain("\"choices\":[{\"delta\":{\"content\":\"Done.\"}}]");
      expect(streamed).toContain("data: [DONE]");
    } finally {
      vi.useRealTimers();
    }
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
      chatHandlers[0]({
        state: "final",
        sessionKey: "main",
        runId: "run-1",
        message: { content: "answer after timeout" },
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
