import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAuth, mockResolveAccessibleWorkspace, mockActivityQuery } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockResolveAccessibleWorkspace: vi.fn(),
  mockActivityQuery: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  activityLog: {
    companyId: Symbol.for("activityLog.companyId"),
    workspaceId: Symbol.for("activityLog.workspaceId"),
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

vi.mock("@/lib/workspace", () => ({
  getCompanyIdForWorkspace: vi.fn(),
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

import { GET } from "./route";

function makeRequest(path: string) {
  return new Request(new URL(path, "http://localhost:3000"));
}

describe("GET /api/activity authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co_1" });
    mockActivityQuery.mockResolvedValue([{ id: "activity_1" }]);
  });

  it("does not query activity rows for unauthenticated callers", async () => {
    mockRequireAuth.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));

    const response = await GET(makeRequest("/api/activity?company_id=co_1") as never);

    expect(response.status).toBe(401);
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });

  it("does not query activity rows when workspace access is denied", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const response = await GET(makeRequest("/api/activity?company_id=co_1") as never);

    expect(response.status).toBe(400);
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });

  it("requires an explicit company scope before querying activity rows", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const response = await GET(makeRequest("/api/activity") as never);

    expect(response.status).toBe(400);
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalled();
    expect(mockActivityQuery).not.toHaveBeenCalled();
  });
});
