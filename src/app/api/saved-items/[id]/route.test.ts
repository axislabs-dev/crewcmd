import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: mockSelect }),
    update: () => ({ set: mockUpdate }),
    delete: () => ({ where: mockDelete }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  savedItems: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
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

import { DELETE, PATCH } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

function selectItem(rows: unknown[]) {
  return {
    where: () => ({ limit: () => Promise.resolve(rows) }),
  };
}

const params = { params: Promise.resolve({ id: "item-1" }) };

describe("PATCH /api/saved-items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("forbids updating an item in an inaccessible scope", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);
    mockSelect.mockReturnValueOnce(selectItem([{ id: "item-1", workspaceId: "other-ws", companyId: null }]));

    const res = await PATCH(makeRequest("/api/saved-items/item-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/saved-items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: null });
  });

  it("forbids deleting an item in an inaccessible scope", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValueOnce(null);
    mockSelect.mockReturnValueOnce(selectItem([{ id: "item-1", workspaceId: "other-ws", companyId: null }]));

    const res = await DELETE(makeRequest("/api/saved-items/item-1"), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
