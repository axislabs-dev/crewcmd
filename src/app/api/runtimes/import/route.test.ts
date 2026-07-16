import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  ownerType: "user" | "company";
  ownerUserId: string | null;
  ownerCompanyId: string | null;
  companyId: string | null;
  metadata: Record<string, unknown> | null;
};

type AgentRow = Record<string, unknown> & {
  id: string;
  callsign: string;
  runtimeRef: string | null;
};

type Field = { key: string };
type Predicate = (row: Record<string, unknown>) => boolean;

const { mockState, mockPushSkillToRuntime, mockEnsureOperatingLayer, agentsTable, companyRuntimesTable } = vi.hoisted(() => ({
  mockState: {
    runtimes: [] as RuntimeRow[],
    agents: [] as AgentRow[],
    insertedAgents: [] as Record<string, unknown>[],
  },
  mockPushSkillToRuntime: vi.fn(),
  mockEnsureOperatingLayer: vi.fn(),
  agentsTable: {
    id: { key: "id" },
    callsign: { key: "callsign" },
    runtimeRef: { key: "runtimeRef" },
  },
  companyRuntimesTable: {
    id: { key: "id" },
  },
}));

vi.mock("@/db/schema", () => ({
  agents: agentsTable,
  companyRuntimes: companyRuntimesTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => row[field.key] === value,
  inArray: (field: Field, values: unknown[]): Predicate => (row) => values.includes(row[field.key]),
  or: (...predicates: Predicate[]): Predicate => (row) => predicates.some((predicate) => predicate(row)),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: Predicate) => {
          const rows = table === companyRuntimesTable ? mockState.runtimes : mockState.agents;
          return Promise.resolve(rows.filter((row) => predicate(row as Record<string, unknown>)));
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: Predicate) => {
          const rows = table === companyRuntimesTable ? mockState.runtimes : mockState.agents;
          for (const row of rows) {
            if (predicate(row as Record<string, unknown>)) Object.assign(row, values);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if (table !== agentsTable) return Promise.resolve([]);
          const agent: Record<string, unknown> = {
            id: `agent_${mockState.insertedAgents.length + 1}`,
            ...values,
          };
          mockState.insertedAgents.push(agent);
          mockState.agents.push({
            ...agent,
            id: String(agent.id),
            callsign: String(agent.callsign),
            runtimeRef: typeof agent.runtimeRef === "string" ? agent.runtimeRef : null,
          });
          return Promise.resolve([{ id: agent.id, callsign: agent.callsign, name: agent.name }]);
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve([]),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  canManageCompanyOwnedAgent: () => true,
  getAgentAccessContext: () => ({
    userId: "user_1",
    activeCompanyId: "co_1",
    memberships: [{ companyId: "co_1", role: "admin" }],
  }),
  normalizeVisibilityForCreation: ({ requestedVisibility }: { requestedVisibility?: string }) => requestedVisibility ?? "private",
  resolveRuntimeOwnership: () => ({
    ownerType: "user",
    ownerUserId: "user_1",
    ownerCompanyId: null,
  }),
}));

vi.mock("@/lib/runtime-callback-url", () => ({
  getRequestOrigin: () => "http://localhost:3000",
}));

vi.mock("@/lib/workspace", () => ({
  grantAgentDefaultWorkspace: vi.fn(async () => undefined),
  grantAgentToWorkspace: vi.fn(async () => undefined),
  listWorkspaceAgents: vi.fn(async () => []),
  resolveAccessibleWorkspace: vi.fn(async () => ({
    id: "ws_personal",
    type: "personal",
    companyId: "co_1",
  })),
  resolveRuntimeWorkspace: vi.fn(async () => null),
}));

vi.mock("@/lib/push-skill-to-runtime", () => ({
  pushSkillToRuntime: (...args: unknown[]) => mockPushSkillToRuntime(...args),
}));

vi.mock("@/lib/runtime-operating-layer", () => ({
  ensureCrewCmdRuntimeOperatingLayer: (...args: unknown[]) => mockEnsureOperatingLayer(...args),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/runtimes/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/runtimes/import Hermes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runtimes.length = 0;
    mockState.agents.length = 0;
    mockState.insertedAgents.length = 0;
  });

  it("imports a Hermes profile as a hermes_api agent and skips OpenClaw sync", async () => {
    mockState.runtimes.push({
      id: "rt_hermes",
      runtimeType: "hermes",
      name: "Hermes",
      gatewayUrl: "http://localhost:8642",
      httpUrl: "http://localhost:8642",
      authToken: "secret",
      ownerType: "user",
      ownerUserId: "user_1",
      ownerCompanyId: null,
      companyId: "co_1",
      metadata: null,
    });

    const response = await POST(makeRequest({
      runtimeId: "rt_hermes",
      workspaceId: "ws_personal",
      agents: [
        {
          id: "hermes-agent",
          name: "Hermes Agent",
          emoji: "\u{1F916}",
          title: "Hermes Agent",
          description: "Hermes profile",
          model: "hermes-agent",
        },
      ],
      ownerType: "user",
      visibility: "private",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      imported: 1,
      reattached: 0,
      warnings: ["runtime skill sync is not supported for hermes"],
    });
    expect(mockState.insertedAgents[0]).toMatchObject({
      callsign: "HERMESAGENT",
      adapterType: "hermes_api",
      provider: "hermes",
      adapterConfig: {
        url: "http://localhost:8642",
        sessionKey: "crewcmd:workspace:ws_personal:runtime:rt_hermes:agent:hermes-agent",
      },
      model: "hermes-agent",
      runtimeId: "rt_hermes",
      runtimeRef: "hermes-agent",
      runtimeConfig: {},
    });
    expect(JSON.stringify(mockState.insertedAgents[0])).not.toContain("secret");
    expect(mockState.insertedAgents[0].adapterConfig).not.toHaveProperty("headers");
    expect(mockPushSkillToRuntime).not.toHaveBeenCalled();
    expect(mockEnsureOperatingLayer).not.toHaveBeenCalled();
  });
});
