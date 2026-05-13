import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Membership = { companyId: string; userId: string; role: "owner" | "admin" | "member" | "viewer" };
type Field = { key: keyof Membership };
type Predicate = (row: Membership) => boolean;

const { mockResolveCurrentUser, memberships } = vi.hoisted(() => ({
  mockResolveCurrentUser: vi.fn(),
  memberships: [] as Membership[],
}));

vi.mock("@/db/schema", () => ({
  companyRoleEnum: { enumValues: ["owner", "admin", "member", "viewer"] },
  companyMembers: {
    companyId: { key: "companyId" },
    userId: { key: "userId" },
    role: { key: "role" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
  and: (...predicates: Predicate[]): Predicate => (row) => predicates.every((predicate) => predicate(row)),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => ({
          limit: (n: number) => Promise.resolve(memberships.filter(predicate).slice(0, n).map(({ role }) => ({ role }))),
        }),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: (...args: unknown[]) => mockResolveCurrentUser(...args),
}));

import { requireCompanyAuditReadAccess } from "./company-audit-access";

function request() {
  return new NextRequest(new URL("http://localhost:3000/api/audit-log?company_id=co_1"));
}

describe("requireCompanyAuditReadAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberships.length = 0;
  });

  it("denies unauthenticated callers", async () => {
    mockResolveCurrentUser.mockResolvedValue(null);

    const response = await requireCompanyAuditReadAccess(request(), "co_1");

    expect(response?.status).toBe(401);
  });

  it("denies users without membership in the requested company", async () => {
    mockResolveCurrentUser.mockResolvedValue({ id: "user_1" });
    memberships.push({ companyId: "co_2", userId: "user_1", role: "admin" });

    const response = await requireCompanyAuditReadAccess(request(), "co_1");

    expect(response?.status).toBe(403);
  });

  it("denies non-admin company members", async () => {
    mockResolveCurrentUser.mockResolvedValue({ id: "user_1" });
    memberships.push({ companyId: "co_1", userId: "user_1", role: "viewer" });

    const response = await requireCompanyAuditReadAccess(request(), "co_1");

    expect(response?.status).toBe(403);
  });

  it("allows company admins and owners", async () => {
    mockResolveCurrentUser.mockResolvedValue({ id: "user_1" });
    memberships.push({ companyId: "co_1", userId: "user_1", role: "admin" });

    await expect(requireCompanyAuditReadAccess(request(), "co_1")).resolves.toBeNull();

    memberships[0].role = "owner";
    await expect(requireCompanyAuditReadAccess(request(), "co_1")).resolves.toBeNull();
  });
});
