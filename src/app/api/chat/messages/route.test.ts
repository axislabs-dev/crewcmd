import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── DB mocks ────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    insert: () => ({ values: mockInsert }),
    update: () => ({ set: mockUpdate }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatMessages: Symbol("chatMessages"),
  chatSessions: Symbol("chatSessions"),
  chatThreads: Symbol("chatThreads"),
  chatSessionEvents: Symbol("chatSessionEvents"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

const mockResolveAccessibleWorkspace = vi.fn().mockResolvedValue({ id: "ws-1", companyId: null });
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

// ── GET /api/chat/messages ──────────────────────────────────────
describe("GET /api/chat/messages", () => {
  const mockMessages = [
    { id: "m1", role: "user", content: "hello", createdAt: "2026-04-01T00:00:00Z", metadata: null },
    { id: "m2", role: "assistant", content: "hi there", createdAt: "2026-04-01T00:00:01Z", metadata: null },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("returns messages for a session", async () => {
    mockSelect
      .mockReturnValueOnce({
        where: () => ({ limit: () => Promise.resolve([{ id: "sess-1", workspaceId: "ws-1", companyId: null }]) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockMessages) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
      });

    const res = await GET(makeRequest("/api/chat/messages?sessionId=sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe("hello");
  });

  it("returns 400 without sessionId or scoped agent/session key", async () => {
    const res = await GET(makeRequest("/api/chat/messages"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("sessionId or ((agentId or sessionKey) + companyId/workspaceId) required");
  });

  it("returns messages for latest agent session", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-company", companyId: "co-1" });
    const session = { id: "sess-runtime", agentId: "runtime-agent", companyId: "co-1", gatewaySessionKey: "runtime-agent" };
    const linkedThread = {
      id: "thread-1",
      agentId: "runtime-agent",
      gatewaySessionKey: "runtime-agent:thread:parent-message-1",
      threadParentSessionId: "sess-runtime",
      threadParentSessionKey: "runtime-agent",
      threadParentMessageId: "parent-message-1",
    };
    mockSelect
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([session]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockMessages) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([linkedThread]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockMessages) }) }),
      });

    const res = await GET(makeRequest("/api/chat/messages?agentId=RuntimeAgent&companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe("sess-runtime");
    expect(body.messages).toHaveLength(2);
    expect(body.threadIndex["id:parent-message-1"]).toMatchObject({
      sessionKey: "runtime-agent:thread:parent-message-1",
      replyCount: 2,
    });
  });

  it("returns thread summaries with durable parent linkage", async () => {
    const linkedThread = {
      id: "thread-1",
      agentId: "runtime-agent",
      gatewaySessionKey: "runtime-agent:thread:server-parent",
      threadParentSessionId: "parent-session-1",
      threadParentSessionKey: "runtime-agent",
      threadParentMessageId: "parent-message-1",
    };
    const newerLinkedThread = {
      ...linkedThread,
      id: "thread-2",
      gatewaySessionKey: "runtime-agent:thread:server-parent-reopened",
    };
    const newerAggregateThread = {
      id: "aggregate-1",
      agentId: "runtime-agent",
      gatewaySessionKey: newerLinkedThread.gatewaySessionKey,
      threadParentSessionId: linkedThread.threadParentSessionId,
      threadParentSessionKey: linkedThread.threadParentSessionKey,
      threadParentMessageId: linkedThread.threadParentMessageId,
      threadSessionId: newerLinkedThread.id,
    };
    const newerMessages = [
      { id: "m3", role: "user", content: "follow up", createdAt: "2026-04-01T00:00:02Z", metadata: null },
      { id: "m4", role: "assistant", content: "new answer", createdAt: "2026-04-01T00:00:03Z", metadata: null },
    ];
    mockSelect
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([newerAggregateThread]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([linkedThread]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockMessages) }) }),
      })
      .mockReturnValueOnce({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(newerMessages) }) }),
      });

    const res = await GET(makeRequest("/api/chat/messages?companyId=co-1&threadParentSessionKey=runtime-agent"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.threads).toHaveLength(2);
    expect(body.threads[0]).toMatchObject({
      sessionId: "thread-1",
      sessionKey: "runtime-agent:thread:server-parent",
      parentSessionId: "parent-session-1",
      parentSessionKey: "runtime-agent",
      parentMessageId: "parent-message-1",
    });
    expect(body.threads[0].messages).toHaveLength(2);
    expect(body.threadSummaries["parent-message-1"]).toMatchObject({
      parentMessageKey: "id:parent-message-1",
      sessionKey: "runtime-agent:thread:server-parent-reopened",
      replyCount: 2,
      replies: [
        { id: "m3", role: "user" },
        { id: "m4", role: "assistant" },
      ],
    });
    expect(body.threadIndex["id:parent-message-1"]).toMatchObject({
      parentMessageId: "parent-message-1",
      sessionKey: "runtime-agent:thread:server-parent-reopened",
      replyCount: 2,
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await GET(makeRequest("/api/chat/messages?sessionId=sess-1"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });
});

// ── POST /api/chat/messages ─────────────────────────────────────
describe("POST /api/chat/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("saves a message with explicit sessionId", async () => {
    const created = { id: "m3", role: "user", content: "test", createdAt: new Date() };
    mockSelect.mockReturnValueOnce({
      where: () => ({ limit: () => Promise.resolve([{ id: "sess-1", workspaceId: "ws-1", companyId: null }]) }),
    });
    mockInsert.mockReturnValue({
      returning: () => Promise.resolve([created]),
    });
    mockUpdate.mockReturnValue({
      where: () => Promise.resolve(),
    });

    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "sess-1",
          role: "user",
          content: "test",
        }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.message.id).toBe("m3");
    expect(body.sessionId).toBe("sess-1");
  });

  it("auto-creates session when agentId + companyId given", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-company", companyId: "co-1" });
    // No existing session found
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
    });

    // Session creation
    const newSession = { id: "sess-new", agentId: "runtime-agent", companyId: "co-1" };
    const createdMsg = { id: "m4", role: "user", content: "hi", createdAt: new Date() };

    // First insert = session, second insert = message
    let insertCall = 0;
    mockInsert.mockImplementation(() => ({
      returning: () => {
        insertCall++;
        return Promise.resolve(insertCall === 1 ? [newSession] : [createdMsg]);
      },
    }));
    mockUpdate.mockReturnValue({ where: () => Promise.resolve() });

    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          agentId: "RuntimeAgent",
          companyId: "co-1",
          role: "user",
          content: "hi",
        }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.sessionId).toBe("sess-new");
  });

  it("auto-creates session when agentId + workspaceId given", async () => {
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
    });

    const newSession = { id: "sess-personal", agentId: "runtime-agent", workspaceId: "ws-1" };
    const createdMsg = { id: "m5", role: "user", content: "hi", createdAt: new Date() };

    let insertCall = 0;
    mockInsert.mockImplementation(() => ({
      returning: () => {
        insertCall++;
        return Promise.resolve(insertCall === 1 ? [newSession] : [createdMsg]);
      },
    }));
    mockUpdate.mockReturnValue({ where: () => Promise.resolve() });

    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          agentId: "RuntimeAgent",
          workspaceId: "ws-1",
          role: "user",
          content: "hi",
        }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.sessionId).toBe("sess-personal");
  });

  it("returns 400 when role is missing", async () => {
    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ content: "no role" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("role and content required");
  });

  it("returns 400 when content is missing", async () => {
    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ role: "user" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("role and content required");
  });

  it("returns 400 when neither sessionId nor scoped agent", async () => {
    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ role: "user", content: "orphan" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("sessionId or (agentId + companyId/workspaceId) required");
  });
});
