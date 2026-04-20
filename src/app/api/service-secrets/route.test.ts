import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockSelectWhere = vi.fn();
const mockReturning = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelectWhere }) }),
    insert: () => ({ values: () => ({ returning: mockReturning }) }),
    update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  serviceSecrets: {
    id: Symbol("id"),
    workspaceId: Symbol("workspaceId"),
    companyId: Symbol("companyId"),
    name: Symbol("name"),
  },
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

const mockResolveAccessibleWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

import { GET, POST } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("/api/service-secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({
      id: "ws_1",
      companyId: "co_1",
    });
    mockWhere.mockResolvedValue([]);
    mockSelectWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockReturning.mockResolvedValue([{
      id: "sec_1",
      name: "evercontent-api-key",
      description: "Primary key",
      value: "abcd1234",
      createdAt: new Date("2026-04-08T00:00:00Z"),
      updatedAt: new Date("2026-04-08T00:00:00Z"),
    }]);
    mockLimit.mockResolvedValue([]);
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
  });

  it("lists masked secret metadata", async () => {
    mockSelectWhere.mockResolvedValue([{
      id: "sec_1",
      name: "evercontent-api-key",
      description: "Primary key",
      value: "abcd1234",
      createdAt: new Date("2026-04-08T00:00:00Z"),
      updatedAt: new Date("2026-04-08T00:00:00Z"),
    }]);

    const res = await GET(makeRequest("/api/service-secrets?workspaceId=ws_1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.secrets[0]).toMatchObject({
      name: "evercontent-api-key",
      maskedValue: "****1234",
    });
  });

  it("creates a secret and never returns the raw value", async () => {
    const res = await POST(makeRequest("/api/service-secrets", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws_1", name: "evercontent-api-key", value: "abcd1234" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.maskedValue).toBe("****1234");
    expect(body.value).toBeUndefined();
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest("/api/service-secrets", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws_1", name: "x", value: "y" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });
});
