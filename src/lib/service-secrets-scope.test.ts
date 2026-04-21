import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  workspacesTable,
  serviceSecretsTable,
  mockWorkspaceLimit,
  mockSecretLimit,
} = vi.hoisted(() => ({
  workspacesTable: {
    __table: Symbol.for("workspaces"),
    id: Symbol.for("workspaces.id"),
    companyId: Symbol.for("workspaces.companyId"),
  },
  serviceSecretsTable: {
    __table: Symbol.for("serviceSecrets"),
    value: Symbol.for("serviceSecrets.value"),
    name: Symbol.for("serviceSecrets.name"),
    workspaceId: Symbol.for("serviceSecrets.workspaceId"),
    companyId: Symbol.for("serviceSecrets.companyId"),
  },
  mockWorkspaceLimit: vi.fn(),
  mockSecretLimit: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: { __table?: symbol }) => {
        if (table === workspacesTable) {
          return {
            where: () => ({
              limit: mockWorkspaceLimit,
            }),
          };
        }

        if (table === serviceSecretsTable) {
          return {
            where: () => ({
              limit: mockSecretLimit,
            }),
          };
        }

        return {
          where: () => ({
            limit: vi.fn(),
          }),
        };
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  workspaces: workspacesTable,
  serviceSecrets: serviceSecretsTable,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}));

import { resolveSecretRef, validateSkillConfigSecretRefs } from "./service-secrets";

describe("service secret scope resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceLimit.mockResolvedValue([{ id: "ws_personal", companyId: null }]);
    mockSecretLimit.mockResolvedValue([{ value: "secret_123" }]);
  });

  it("prefers the workspace company scope over a stale fallback company id", async () => {
    const secret = await resolveSecretRef(
      { workspaceId: "ws_personal", companyId: "co_stale" },
      { secretRef: { name: "evercontent_api_key" } }
    );

    expect(secret).toBe("secret_123");
    expect(mockWorkspaceLimit).toHaveBeenCalledTimes(1);
    expect(mockSecretLimit).toHaveBeenCalledTimes(1);
  });

  it("validates secret refs for a personal workspace even when a stale company id is passed", async () => {
    const validation = await validateSkillConfigSecretRefs(
      { workspaceId: "ws_personal", companyId: "co_stale" },
      { secretRef: { name: "evercontent_api_key" } }
    );

    expect(validation).toEqual({ ok: true });
  });
});
