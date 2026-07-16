import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealRuntimeAuthToken } from "./runtime-token-crypto";

type Field = { key: string };
type Predicate = (row: Record<string, unknown>) => boolean;

const { mockState, agentsTable, companyRuntimesTable } = vi.hoisted(() => ({
  mockState: {
    agents: [] as Array<Record<string, unknown>>,
    runtimes: [] as Array<Record<string, unknown>>,
  },
  agentsTable: Symbol("agents"),
  companyRuntimesTable: {
    id: { key: "id" },
    authToken: { key: "authToken" },
    metadata: { key: "metadata" },
  },
}));

vi.mock("@/db/schema", () => ({
  agents: agentsTable,
  companyRuntimes: companyRuntimesTable,
  companyModelDefaults: {
    companyId: { key: "companyId" },
    model: { key: "model" },
    modelProfileId: { key: "modelProfileId" },
  },
  modelProfiles: {
    id: { key: "id" },
    primaryModel: { key: "primaryModel" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === agentsTable ? mockState.agents : mockState.runtimes;
        const direct = Promise.resolve(rows);
        return Object.assign(direct, {
          where: (predicate: Predicate) => ({
            limit: (count: number) => Promise.resolve(rows.filter(predicate).slice(0, count)),
          }),
        });
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

import { resolveAgent } from "./resolve-agent";

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    callsign: "SCOUT",
    name: "Scout",
    adapterType: "openclaw_gateway",
    adapterConfig: {
      url: "https://runtime.example",
      headers: {
        Authorization: "Bearer stale-secret",
        "X-Trace-Mode": "enabled",
      },
    },
    runtimeConfig: {},
    runtimeId: "runtime-1",
    companyId: null,
    ownerCompanyId: null,
    model: null,
    workspacePath: null,
    status: "offline",
    ...overrides,
  };
}

describe("resolveAgent runtime credentials", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "resolve-agent-test-secret");
    mockState.agents.length = 0;
    mockState.runtimes.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hydrates the current linked-runtime token for server-side execution", async () => {
    mockState.agents.push(agent());
    mockState.runtimes.push({
      id: "runtime-1",
      authToken: sealRuntimeAuthToken("current-secret"),
      metadata: { capabilitySnapshot: { defaultModel: "runtime-model" } },
    });

    await expect(resolveAgent("scout")).resolves.toMatchObject({
      effectiveModel: "runtime-model",
      adapterConfig: {
        url: "https://runtime.example",
        headers: {
          Authorization: "Bearer current-secret",
          "X-Trace-Mode": "enabled",
        },
      },
    });
  });

  it("removes stale runtime auth when the linked runtime cannot be resolved", async () => {
    mockState.agents.push(agent());

    await expect(resolveAgent("SCOUT")).resolves.toMatchObject({
      adapterConfig: {
        url: "https://runtime.example",
        headers: { "X-Trace-Mode": "enabled" },
      },
    });
  });

  it("preserves credentials for agents that are not runtime-linked", async () => {
    mockState.agents.push(agent({ runtimeId: null }));

    await expect(resolveAgent("SCOUT")).resolves.toMatchObject({
      adapterConfig: {
        headers: {
          Authorization: "Bearer stale-secret",
          "X-Trace-Mode": "enabled",
        },
      },
    });
  });
});
