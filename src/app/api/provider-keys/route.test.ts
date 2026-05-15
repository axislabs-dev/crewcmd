import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  const companyProviderKeys = {
    id: "companyProviderKeys.id",
    companyId: "companyProviderKeys.companyId",
    provider: "companyProviderKeys.provider",
  };
  const companyMembers = {
    userId: "companyMembers.userId",
    companyId: "companyMembers.companyId",
    role: "companyMembers.role",
  };

  return {
    companyProviderKeys,
    companyMembers,
    providerKeys: vi.fn(),
    providerKeyLookup: vi.fn(),
    membership: vi.fn(),
    deleteWhere: vi.fn(),
    requireAuth: vi.fn(),
    resolveCurrentUser: vi.fn(),
  };
});

vi.mock("@/db/schema", () => ({
  companyProviderKeys: mocks.companyProviderKeys,
  companyMembers: mocks.companyMembers,
}));

vi.mock("@/db", () => ({
  db: {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === mocks.companyMembers) {
            return { limit: mocks.membership };
          }
          if (table === mocks.companyProviderKeys && selection?.companyId) {
            return { limit: mocks.providerKeyLookup };
          }
          return mocks.providerKeys();
        },
      }),
    }),
    delete: () => ({ where: mocks.deleteWhere }),
  },
  withRetry: (fn: () => unknown) => fn(),
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

import { DELETE, GET } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

describe("/api/provider-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(null);
    mocks.resolveCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.membership.mockResolvedValue([{ role: "admin" }]);
    mocks.providerKeys.mockResolvedValue([
      {
        id: "key-1",
        provider: "openai",
        label: "Production",
        apiKey: "sk-production-secret",
        createdAt: new Date("2026-04-01T00:00:00Z"),
        updatedAt: new Date("2026-04-02T00:00:00Z"),
      },
    ]);
    mocks.providerKeyLookup.mockResolvedValue([{ companyId: "co-1" }]);
    mocks.deleteWhere.mockResolvedValue(undefined);
  });

  it("requires authentication before listing provider key metadata", async () => {
    mocks.requireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await GET(makeRequest("/api/provider-keys?companyId=co-1"));

    expect(res.status).toBe(401);
    expect(mocks.providerKeys).not.toHaveBeenCalled();
  });

  it("requires a company owner or admin before listing provider key metadata", async () => {
    mocks.membership.mockResolvedValue([{ role: "member" }]);

    const res = await GET(makeRequest("/api/provider-keys?companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mocks.providerKeys).not.toHaveBeenCalled();
  });

  it("lists only masked provider key metadata for company admins", async () => {
    const res = await GET(makeRequest("/api/provider-keys?companyId=co-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys).toEqual([
      {
        id: "key-1",
        provider: "openai",
        label: "Production",
        maskedKey: "****cret",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("sk-production-secret");
  });

  it("authorizes deletes against the provider key company", async () => {
    const res = await DELETE(makeRequest("/api/provider-keys?id=key-1", { method: "DELETE" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.membership).toHaveBeenCalled();
    expect(mocks.deleteWhere).toHaveBeenCalled();
  });
});
