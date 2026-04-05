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
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
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
  });

  it("returns messages for a session", async () => {
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockMessages) }) }),
    });

    const res = await GET(makeRequest("/api/chat/messages?sessionId=sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe("hello");
  });

  it("returns 400 without sessionId", async () => {
    const res = await GET(makeRequest("/api/chat/messages"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("sessionId required");
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
  });

  it("saves a message with explicit sessionId", async () => {
    const created = { id: "m3", role: "user", content: "test", createdAt: new Date() };
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
    // No existing session found
    mockSelect.mockReturnValue({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
    });

    // Session creation
    const newSession = { id: "sess-new", agentId: "neo", companyId: "co-1" };
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
          agentId: "Neo",
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

  it("returns 400 when neither sessionId nor agentId+companyId", async () => {
    const res = await POST(
      makeRequest("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ role: "user", content: "orphan" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("sessionId or (agentId + companyId) required");
  });
});
