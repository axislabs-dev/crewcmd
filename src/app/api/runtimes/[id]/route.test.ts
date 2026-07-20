import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type RuntimeRow = {
  id: string;
  companyId: string | null;
  ownerType: "user" | "company";
  ownerUserId: string | null;
  ownerCompanyId: string | null;
  isPrimary: boolean;
};

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  cleanup: vi.fn(),
  deleteManagedResources: vi.fn(),
  listManagedResources: vi.fn(),
  deletedTables: [] as string[],
  updatedTables: [] as string[],
  updatedValues: [] as Record<string, unknown>[],
  runtime: {
    id: "runtime-1",
    companyId: null,
    ownerType: "user",
    ownerUserId: "user-1",
    ownerCompanyId: null,
    isPrimary: false,
  } as RuntimeRow,
}));

vi.mock("@/db/schema", () => ({
  agents: { table: "agents", id: "agents.id", runtimeId: "agents.runtimeId" },
  companyRuntimes: {
    table: "companyRuntimes",
    id: "companyRuntimes.id",
    companyId: "companyRuntimes.companyId",
    ownerType: "companyRuntimes.ownerType",
    ownerUserId: "companyRuntimes.ownerUserId",
    ownerCompanyId: "companyRuntimes.ownerCompanyId",
    isPrimary: "companyRuntimes.isPrimary",
  },
  cronJobs: { table: "cronJobs", id: "cronJobs.id" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  isNull: vi.fn((field: unknown) => ({ field, value: null })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: { table: string }) => ({
        where: () => table.table === "companyRuntimes"
          ? { limit: async () => [mocks.runtime] }
          : Promise.resolve([{ id: "agent-1" }]),
      }),
    }),
    update: (table: { table: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.updatedTables.push(table.table);
          mocks.updatedValues.push(values);
        },
      }),
    }),
    delete: (table: { table: string }) => ({
      where: async () => {
        mocks.deletedTables.push(table.table);
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  canManageCompanyOwnedAgent: vi.fn(() => false),
  getAgentAccessContext: () => mocks.access(),
}));

vi.mock("@/lib/runtime-operating-layer", () => ({
  cleanupCrewCmdRuntimeOperatingLayer: (...args: unknown[]) => mocks.cleanup(...args),
}));

vi.mock("@/lib/runtime-managed-resources", () => ({
  deleteRuntimeManagedResources: (...args: unknown[]) => mocks.deleteManagedResources(...args),
  listRuntimeManagedResources: (...args: unknown[]) => mocks.listManagedResources(...args),
}));

vi.mock("@/lib/runtime-api-dto", () => ({
  toBrowserSafeRuntime: (runtime: unknown) => runtime,
}));

import { DELETE } from "./route";

function makeRequest(cleanup?: string) {
  const url = new URL("http://localhost/api/runtimes/runtime-1");
  if (cleanup) url.searchParams.set("cleanup", cleanup);
  return new NextRequest(url, { method: "DELETE" });
}

function context() {
  return { params: Promise.resolve({ id: "runtime-1" }) };
}

describe("DELETE /api/runtimes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletedTables.length = 0;
    mocks.updatedTables.length = 0;
    mocks.updatedValues.length = 0;
    mocks.access.mockResolvedValue({ userId: "user-1" });
    mocks.listManagedResources.mockResolvedValue([
      { resourceType: "agent-skill", externalId: null },
      { resourceType: "cron-job", externalId: null },
    ]);
  });

  it("offers a local fallback when remote cleanup fails", async () => {
    mocks.cleanup.mockRejectedValue(new Error("pairing required"));

    const response = await DELETE(makeRequest(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNTIME_CLEANUP_FAILED",
      canSkipCleanup: true,
      linkedAgents: 1,
      managedResources: 2,
    });
    expect(mocks.deleteManagedResources).not.toHaveBeenCalled();
    expect(mocks.updatedTables).toEqual([]);
    expect(mocks.deletedTables).toEqual([]);
  });

  it("forgets locally while preserving runtime agent identity", async () => {
    const response = await DELETE(makeRequest("skip"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      detachedAgents: 1,
      cleanupSkipped: true,
    });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deleteManagedResources).toHaveBeenCalledWith("runtime-1");
    expect(mocks.updatedTables).toEqual(["agents"]);
    expect(mocks.updatedValues).toEqual([{ runtimeId: null, status: "offline" }]);
    expect(mocks.deletedTables).toEqual(["companyRuntimes"]);
  });

  it("rejects unsupported cleanup modes", async () => {
    const response = await DELETE(makeRequest("force"), context());

    expect(response.status).toBe(400);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.deleteManagedResources).not.toHaveBeenCalled();
  });
});
