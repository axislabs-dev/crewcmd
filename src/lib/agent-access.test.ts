import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRuntimeRows } = vi.hoisted(() => ({
  mockRuntimeRows: [] as Array<{
    id: string;
    companyId: string | null;
    ownerType: "user" | "company";
    ownerUserId: string | null;
    ownerCompanyId: string | null;
  }>,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => null) })),
}));

vi.mock("@/lib/resolve-user", () => ({
  resolveCurrentUser: vi.fn(async () => null),
}));

vi.mock("@/db/schema", () => ({
  companyRoleEnum: { enumValues: ["owner", "admin", "member", "viewer"] },
  agents: {
    ownerUserId: Symbol.for("agents.ownerUserId"),
    ownerCompanyId: Symbol.for("agents.ownerCompanyId"),
    ownerType: Symbol.for("agents.ownerType"),
    visibility: Symbol.for("agents.visibility"),
  },
  companyMembers: {
    companyId: Symbol.for("companyMembers.companyId"),
    role: Symbol.for("companyMembers.role"),
    userId: Symbol.for("companyMembers.userId"),
  },
  companyRuntimes: {
    id: Symbol.for("companyRuntimes.id"),
    companyId: Symbol.for("companyRuntimes.companyId"),
    ownerType: Symbol.for("companyRuntimes.ownerType"),
    ownerUserId: Symbol.for("companyRuntimes.ownerUserId"),
    ownerCompanyId: Symbol.for("companyRuntimes.ownerCompanyId"),
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockRuntimeRows),
        }),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

import {
  canManageCompanyOwnedAgent,
  resolveRuntimeOwnership,
  runtimeOwnershipValues,
  type AgentAccessContext,
} from "./agent-access";

describe("runtime ownership helpers", () => {
  beforeEach(() => {
    mockRuntimeRows.length = 0;
  });

  it("uses personal ownership for BYO runtimes while retaining storage company scope", () => {
    expect(
      runtimeOwnershipValues({
        ownerType: "user",
        userId: "user_1",
        activeCompanyId: "co_1",
      })
    ).toEqual({
      ownerType: "user",
      ownerUserId: "user_1",
      ownerCompanyId: null,
      companyId: "co_1",
    });
  });

  it("requires a company workspace for company-owned runtimes", () => {
    expect(() =>
      runtimeOwnershipValues({
        ownerType: "company",
        userId: "user_1",
        activeCompanyId: null,
      })
    ).toThrow("Company-owned runtimes require a company workspace");
  });

  it("normalizes legacy company-owned runtime ownership to ownerCompanyId", async () => {
    mockRuntimeRows.push({
      id: "rt_1",
      companyId: "co_1",
      ownerType: "company",
      ownerUserId: null,
      ownerCompanyId: null,
    });

    await expect(resolveRuntimeOwnership("rt_1")).resolves.toEqual({
      ownerType: "company",
      ownerUserId: null,
      ownerCompanyId: "co_1",
    });
  });

  it("allows only company admins to manage company-owned agents", () => {
    const ctx: AgentAccessContext = {
      userId: "user_1",
      activeCompanyId: "co_1",
      memberships: [
        { companyId: "co_1", role: "member" },
        { companyId: "co_2", role: "admin" },
      ],
    };

    expect(canManageCompanyOwnedAgent(ctx, "co_1")).toBe(false);
    expect(canManageCompanyOwnedAgent(ctx, "co_2")).toBe(true);
  });
});
