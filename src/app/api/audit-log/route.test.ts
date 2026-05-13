import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockRequireAuth, mockRequireAccess, mockAuditQuery } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireAccess: vi.fn(),
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

vi.mock("@/lib/company-audit-access", () => ({
  requireCompanyAuditReadAccess: (...args: unknown[]) => mockRequireAccess(...args),
}));

import { GET } from "./route";

function makeRequest(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("GET /api/audit-log authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockRequireAccess.mockResolvedValue(null);
    mockAuditQuery.mockResolvedValue([{ id: "audit_1" }]);
  });

  it("does not query audit rows for unauthenticated callers", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await GET(makeRequest("/api/audit-log?company_id=co_1"));

    expect(response.status).toBe(401);
    expect(mockRequireAccess).not.toHaveBeenCalled();
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });

  it("does not query audit rows when company access is denied", async () => {
    mockRequireAccess.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

    const response = await GET(makeRequest("/api/audit-log?company_id=co_1"));

    expect(response.status).toBe(403);
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });

  it("requires an explicit company scope before querying audit rows", async () => {
    const response = await GET(makeRequest("/api/audit-log"));

    expect(response.status).toBe(400);
    expect(mockRequireAccess).not.toHaveBeenCalled();
    expect(mockAuditQuery).not.toHaveBeenCalled();
  });
});
