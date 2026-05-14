import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    insert: () => ({ values: mockInsert }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  savedItems: {},
  chatMessages: {},
  chatSessions: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  inArray: vi.fn(),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

const mockAuth = vi.fn().mockResolvedValue({ user: { id: "user-1" } });
vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockResolveAccessibleWorkspace = vi.fn().mockResolvedValue({ id: "ws-1", companyId: null });
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

function savedItemsQuery(rows: unknown[]) {
  return {
    where: () => ({
      orderBy: () => ({ limit: () => Promise.resolve(rows) }),
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

describe("GET /api/saved-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("requires access to an explicit workspace scope", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);

    const res = await GET(makeRequest("/api/saved-items?workspaceId=other-ws"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitWorkspaceId: "other-ws",
      requireExplicitForBearer: true,
    }));
  });

  it("filters saved items that are no longer in an accessible scope", async () => {
    mockResolveAccessibleWorkspace
      .mockResolvedValueOnce({ id: "active-ws" })
      .mockResolvedValueOnce(null);
    mockSelect.mockReturnValueOnce(savedItemsQuery([
      { id: "item-1", sourceType: "task", sourceId: "task-1", workspaceId: "active-ws", companyId: null },
      { id: "item-2", sourceType: "task", sourceId: "task-2", workspaceId: "other-ws", companyId: null },
    ]));

    const res = await GET(makeRequest("/api/saved-items"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("item-1");
  });
});

describe("POST /api/saved-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("forbids creating an item in an inaccessible explicit workspace", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);

    const res = await POST(makeRequest("/api/saved-items", {
      method: "POST",
      body: JSON.stringify({ sourceType: "task", sourceId: "task-1", workspaceId: "other-ws" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("forbids saving a chat message from an inaccessible session", async () => {
    mockResolveAccessibleWorkspace
      .mockResolvedValueOnce({ id: "requested-ws" })
      .mockResolvedValueOnce(null);
    mockSelect.mockReturnValueOnce(messageJoin([
      { id: "msg-1", content: "secret", role: "assistant", workspaceId: "other-ws", companyId: null },
    ]));

    const res = await POST(makeRequest("/api/saved-items", {
      method: "POST",
      body: JSON.stringify({
        sourceType: "chat_message",
        sourceId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "requested-ws",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
