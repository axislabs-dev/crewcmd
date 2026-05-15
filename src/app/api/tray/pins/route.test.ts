import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    insert: () => ({ values: mockInsert }),
    update: () => ({ set: mockUpdate }),
    delete: () => ({ where: mockDelete }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  chatSessions: {},
  chatThreads: {},
  tasks: {},
  trayPins: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  or: vi.fn(),
}));

const mockAuth = vi.fn().mockResolvedValue({ user: { id: "user-1" } });
vi.mock("@/lib/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

const mockCanAccessChatSession = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/chat-session-access", () => ({
  canAccessChatSession: (...a: unknown[]) => mockCanAccessChatSession(...a),
}));

const mockResolveAccessibleWorkspace = vi.fn().mockResolvedValue({ id: "ws-1", companyId: "co-1" });
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

import { DELETE, GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

function selectRows(rows: unknown[]) {
  return { where: () => ({ limit: () => Promise.resolve(rows), orderBy: () => Promise.resolve(rows) }) };
}

function insertReturning(rows: unknown[]) {
  return { onConflictDoUpdate: () => ({ returning: () => Promise.resolve(rows) }) };
}

describe("/api/tray/pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockCanAccessChatSession.mockResolvedValue(true);
  });

  it("lists tray pins for the current workspace", async () => {
    mockSelect.mockReturnValueOnce({
      where: () => ({ orderBy: () => Promise.resolve([{ id: "pin-1", targetType: "task" }]) }),
    });

    const res = await GET(makeRequest("/api/tray/pins?workspaceId=ws-1&companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pins).toHaveLength(1);
  });

  it("creates a task tray pin after workspace access is confirmed", async () => {
    mockSelect.mockReturnValueOnce(selectRows([
      { id: "task-1", title: "Review PR", shortId: 12, status: "in_progress", priority: "high", workspaceId: "ws-1", companyId: "co-1" },
    ]));
    mockInsert.mockReturnValueOnce(insertReturning([{ id: "pin-1", targetType: "task", targetId: "task-1" }]));

    const res = (await POST(makeRequest("/api/tray/pins", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-1", companyId: "co-1", targetType: "task", targetId: "task-1" }),
    })))!;
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.pin).toMatchObject({ id: "pin-1", targetType: "task" });
  });

  it("rejects a task tray pin outside the active workspace", async () => {
    mockSelect.mockReturnValueOnce(selectRows([
      { id: "task-1", title: "Other task", workspaceId: "other-ws", companyId: "other-co" },
    ]));

    const res = (await POST(makeRequest("/api/tray/pins", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-1", companyId: "co-1", targetType: "task", targetId: "task-1" }),
    })))!;
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates a chat session tray pin after chat access is confirmed", async () => {
    mockSelect.mockReturnValueOnce(selectRows([
      { id: "sess-1", agentId: "neo", title: "Planning", gatewaySessionKey: "agent:main:neo", workspaceId: "ws-1", companyId: "co-1", channelId: null },
    ]));
    mockInsert.mockReturnValueOnce(insertReturning([{ id: "pin-1", targetType: "chat_session", targetId: "sess-1" }]));

    const res = (await POST(makeRequest("/api/tray/pins", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-1", companyId: "co-1", targetType: "chat_session", targetId: "sess-1" }),
    })))!;

    expect(res.status).toBe(201);
    expect(mockCanAccessChatSession).toHaveBeenCalled();
  });

  it("creates a chat thread tray pin after chat access is confirmed", async () => {
    mockSelect.mockReturnValueOnce(selectRows([
      { id: "thread-1", agentId: "neo", threadSessionKey: "agent:main:neo:thread:1", parentSessionKey: "agent:main:neo", parentMessageId: "msg-1", workspaceId: "ws-1", companyId: "co-1", channelId: null },
    ]));
    mockInsert.mockReturnValueOnce(insertReturning([{ id: "pin-1", targetType: "chat_thread", targetId: "thread-1" }]));

    const res = (await POST(makeRequest("/api/tray/pins", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-1", companyId: "co-1", targetType: "chat_thread", targetId: "thread-1" }),
    })))!;

    expect(res.status).toBe(201);
    expect(mockCanAccessChatSession).toHaveBeenCalled();
  });

  it("deletes only the current user's tray pin", async () => {
    mockDelete.mockReturnValueOnce({ returning: () => Promise.resolve([{ id: "pin-1" }]) });

    const res = await DELETE(makeRequest("/api/tray/pins?id=pin-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(1);
  });
});
