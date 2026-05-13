import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockRequireAuth, mockRequireAccess, mockActivityQuery } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireAccess: vi.fn(),
  mockActivityQuery: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  activityLog: {
    companyId: Symbol.for("activityLog.companyId"),
    agentId: Symbol.for("activityLog.agentId"),
    actionType: Symbol.for("activityLog.actionType"),
    createdAt: Symbol.for("activityLog.createdAt"),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: mockActivityQuery }),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  },
  withRetry: (fn: () => unknown) => fn(),
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

describe("GET /api/activity authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockRequireAccess.mockResolvedValue(null);
    mockActivityQuery.mockResolvedValue([{ id: "activity_1" }]);
  });

  it("does not query activity rows for unauthenticated callers", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await GET(makeRequest("/api/activity?company_id=co_1"));

    expect(response.status).toBe(401);
    expect(mockRequireAccess).not.toHaveBeenCalled();
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });

  it("does not query activity rows when company access is denied", async () => {
    mockRequireAccess.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

    const response = await GET(makeRequest("/api/activity?company_id=co_1"));

    expect(response.status).toBe(403);
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });

  it("requires an explicit company scope before querying activity rows", async () => {
    const response = await GET(makeRequest("/api/activity"));

    expect(response.status).toBe(400);
    expect(mockRequireAccess).not.toHaveBeenCalled();
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });
});
