import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  const companies = {
    id: "companies.id",
    settings: "companies.settings",
  };
  const companyMembers = {
    companyId: "companyMembers.companyId",
    userId: "companyMembers.userId",
    role: "companyMembers.role",
  };
  return {
    companies,
    companyMembers,
    requireAuth: vi.fn(),
    resolveCurrentUser: vi.fn(),
    membership: vi.fn(),
    companyLookup: vi.fn(),
    updateReturning: vi.fn(),
  };
});

vi.mock("@/db/schema", () => ({
  companies: mocks.companies,
  companyMembers: mocks.companyMembers,
}));

vi.mock("@/db", () => ({
  db: {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: selection?.role || table === mocks.companyMembers ? mocks.membership : mocks.companyLookup,
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => ({
          returning: () => mocks.updateReturning(updates),
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
}));

vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...args: unknown[]) => mocks.requireAuth(...args),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: (...args: unknown[]) => mocks.resolveCurrentUser(...args),
}));

import { GET, PATCH } from "./route";

function makeRequest(init?: RequestInit) {
  return new NextRequest(new URL("http://localhost:3000/api/companies/co-1"), init as never);
}

const params = { params: Promise.resolve({ id: "co-1" }) };

describe("/api/companies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(null);
    mocks.resolveCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.membership.mockResolvedValue([{ role: "admin" }]);
    mocks.companyLookup.mockResolvedValue([
      {
        id: "co-1",
        name: "Crew",
        settings: { existing: true, agentStyle: { visual: { styleId: "builtin:orbital-reactor" } } },
      },
    ]);
    mocks.updateReturning.mockImplementation((updates: Record<string, unknown>) => Promise.resolve([{ id: "co-1", ...updates }]));
  });

  it("requires membership before reading a company", async () => {
    mocks.membership.mockResolvedValue([]);

    const res = await GET(makeRequest(), params);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(mocks.companyLookup).not.toHaveBeenCalled();
  });

  it("requires owner or admin before updating a company", async () => {
    mocks.membership.mockResolvedValue([{ role: "member" }]);

    const res = await PATCH(makeRequest({ method: "PATCH", body: JSON.stringify({ name: "New" }) }), params);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mocks.updateReturning).not.toHaveBeenCalled();
  });

  it("merges settings updates instead of replacing unrelated settings", async () => {
    const res = await PATCH(
      makeRequest({
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            agentStyle: {
              visual: {
                styleId: "builtin:command-core",
                accent: "team",
              },
            },
          },
        }),
      }),
      params
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings).toEqual({
      existing: true,
      agentStyle: {
        visual: {
          styleId: "builtin:command-core",
          accent: "team",
        },
      },
    });
  });

  it("requires authentication before company access", async () => {
    mocks.requireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await GET(makeRequest(), params);

    expect(res.status).toBe(401);
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});
