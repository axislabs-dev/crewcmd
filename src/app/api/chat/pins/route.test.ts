import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    insert: () => ({ values: mockInsert }),
    delete: () => ({ where: mockDelete }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatMessagePins: Symbol("chatMessagePins"),
  chatMessages: Symbol("chatMessages"),
  chatSessions: Symbol("chatSessions"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  inArray: vi.fn(),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

const mockAuth = vi.fn().mockResolvedValue({ user: { id: "user-1" } });
vi.mock("@/lib/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
}));

const mockResolveAccessibleWorkspace = vi.fn().mockResolvedValue({ id: "ws-1", companyId: null });
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

const mockCanAccessChatSession = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/chat-session-access", () => ({
  canAccessChatSession: (...a: unknown[]) => mockCanAccessChatSession(...a),
}));

import { DELETE, GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

function sessionLookup(rows: unknown[]) {
  return {
    where: () => ({ limit: () => Promise.resolve(rows) }),
  };
}

function joinedSelect(rows: unknown[]) {
  return {
    innerJoin: () => ({
      innerJoin: () => ({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }),
      }),
    }),
  };
}

function messageJoin(rows: unknown[]) {
  return {
    innerJoin: () => ({
      where: () => ({ limit: () => Promise.resolve(rows) }),
    }),
  };
}

describe("GET /api/chat/pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
    mockCanAccessChatSession.mockResolvedValue(true);
  });

  it("returns pins for an accessible session", async () => {
    mockSelect
      .mockReturnValueOnce(sessionLookup([{ id: "sess-1", workspaceId: "ws-1", companyId: null }]))
      .mockReturnValueOnce(joinedSelect([{ id: "pin-1", messageId: "msg-1" }]));

    const res = await GET(makeRequest("/api/chat/pins?sessionId=sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pins).toHaveLength(1);
    expect(mockCanAccessChatSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: "sess-1",
      workspaceId: "ws-1",
    }));
  });

  it("forbids pins for an inaccessible sessionId", async () => {
    mockCanAccessChatSession.mockResolvedValueOnce(false);
    mockSelect.mockReturnValueOnce(sessionLookup([{ id: "sess-1", workspaceId: "other-ws", companyId: null }]));

    const res = await GET(makeRequest("/api/chat/pins?sessionId=sess-1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("requires accessible explicit scope when resolving by sessionKey", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);

    const res = await GET(makeRequest("/api/chat/pins?sessionKey=agent-thread&companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("forbids pins when sessionKey resolves to an unreadable channel session", async () => {
    mockCanAccessChatSession.mockResolvedValueOnce(false);
    mockSelect.mockReturnValueOnce({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([
        { id: "sess-channel", workspaceId: "ws-1", companyId: "co-1", channelId: "channel_other" },
      ]) }) }),
    });

    const res = await GET(makeRequest("/api/chat/pins?sessionKey=agent-thread&companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });
});

describe("POST /api/chat/pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
    mockCanAccessChatSession.mockResolvedValue(true);
  });

  it("pins a message in an accessible session", async () => {
    mockSelect
      .mockReturnValueOnce(messageJoin([{ id: "msg-1", sessionId: "sess-1", workspaceId: "ws-1", companyId: null }]))
      .mockReturnValueOnce({ where: () => ({ orderBy: () => Promise.resolve([{ id: "pin-1" }]) }) });
    mockInsert.mockReturnValue({
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve([{ id: "pin-1", messageId: "msg-1" }]) }),
    });

    const res = await POST(makeRequest("/api/chat/pins", {
      method: "POST",
      body: JSON.stringify({ messageId: "msg-1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.pin).toMatchObject({ id: "pin-1", messageId: "msg-1" });
  });

  it("forbids pinning a message in an inaccessible session", async () => {
    mockCanAccessChatSession.mockResolvedValueOnce(false);
    mockSelect.mockReturnValueOnce(messageJoin([{ id: "msg-1", sessionId: "sess-1", workspaceId: "other-ws", companyId: null }]));

    const res = await POST(makeRequest("/api/chat/pins", {
      method: "POST",
      body: JSON.stringify({ messageId: "msg-1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/chat/pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
    mockCanAccessChatSession.mockResolvedValue(true);
  });

  it("deletes a pin for an accessible message", async () => {
    mockSelect.mockReturnValueOnce(messageJoin([{ id: "msg-1", workspaceId: "ws-1", companyId: null }]));
    mockDelete.mockReturnValue({ returning: () => Promise.resolve([{ id: "pin-1" }]) });

    const res = await DELETE(makeRequest("/api/chat/pins?messageId=msg-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(1);
  });

  it("forbids deleting a pin for an inaccessible message", async () => {
    mockCanAccessChatSession.mockResolvedValueOnce(false);
    mockSelect.mockReturnValueOnce(messageJoin([{ id: "msg-1", workspaceId: "other-ws", companyId: null }]));

    const res = await DELETE(makeRequest("/api/chat/pins?messageId=msg-1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
