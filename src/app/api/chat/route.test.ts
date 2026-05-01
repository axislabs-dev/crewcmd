import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/chat-recovery", () => ({
  selectRecoveredAssistantText: vi.fn(() => ""),
}));

vi.mock("@/lib/agent-mode-diagnostics", () => ({
  createAgentModeSessionId: vi.fn(() => "diag-chat-route"),
  publishAgentModeDiagnostic: vi.fn(),
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
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockGetGatewayClient.mockResolvedValue({
      on: vi.fn(),
      off: vi.fn(),
      chatSend: vi.fn(() => new Promise(() => {})),
      chatAbort: vi.fn(() => Promise.resolve()),
      chatHistory: vi.fn(),
      rpc: vi.fn(),
    });
  });

  it("returns an SSE response before gateway chatSend resolves", async () => {
    const response = await POST(makeRequest({
      messages: [{ role: "user", content: "hello" }],
      agent: "main",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const firstChunk = await readFirstChunk(response);
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
    expect(chatAbort).toHaveBeenCalledWith({ sessionKey: "main" });
  });
});
