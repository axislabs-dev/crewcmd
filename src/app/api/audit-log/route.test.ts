import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAuth, mockResolveAccessibleWorkspace, mockAuditQuery } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockResolveAccessibleWorkspace: vi.fn(),
  mockAuditQuery: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  auditLog: {
    companyId: Symbol.for("auditLog.companyId"),
    actor: Symbol.for("auditLog.actor"),
    action: Symbol.for("auditLog.action"),
    entityType: Symbol.for("auditLog.entityType"),
    createdAt: Symbol.for("auditLog.createdAt"),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: mockAuditQuery }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

import { GET } from "./route";

function makeRequest(path: string) {
  return new Request(new URL(path, "http://localhost:3000"));
}

describe("GET /api/audit-log authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co_1" });
    mockAuditQuery.mockResolvedValue([{ id: "audit_1" }]);
  });

  it("does not query audit rows for unauthenticated callers", async () => {
    mockRequireAuth.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await GET(makeRequest("/api/audit-log?company_id=co_1") as never);

    expect(response.status).toBe(401);
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });

  it("does not query audit rows when company access is denied", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const response = await GET(makeRequest("/api/audit-log?company_id=co_1") as never);

    expect(response.status).toBe(403);
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });

  it("requires an explicit company scope before querying audit rows", async () => {
    const response = await GET(makeRequest("/api/audit-log") as never);

    expect(response.status).toBe(400);
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });
});
