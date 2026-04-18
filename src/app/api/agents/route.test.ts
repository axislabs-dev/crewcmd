import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAgents = [
  {
    id: "a1",
    callsign: "SCOUT",
    name: "Scout",
    title: "Engineer",
    emoji: "\u{1F916}",
    color: "#00f0ff",
    status: "online",
    currentTask: "Fix bug",
    lastActive: new Date("2026-04-01"),
    reportsTo: null,
    soulContent: null,
    adapterType: "claude_code",
    provider: "anthropic",
    adapterConfig: {},
    runtimeConfig: {},
    role: "engineer",
    model: "claude-sonnet-4-6",
    workspacePath: "/workspace",
    canvasPosition: null,
  },
];

const mockFromHeartbeats = vi.fn();
const mockListWorkspaceAgents = vi.fn();
const mockGetAgentWorkspaceIds = vi.fn();
const mockResolveAccessibleWorkspace = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: symbol) => ({
        catch: (...args: Parameters<Promise<unknown>["catch"]>) => mockFromHeartbeats().catch(...args),
        then: (...args: Parameters<Promise<unknown>["then"]>) => {
          return mockFromHeartbeats().then(...args);
        },
        where: () => mockFromHeartbeats(),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  agents: Symbol.for("agents"),
  agentHeartbeats: Symbol.for("heartbeats"),
}));

vi.mock("@/lib/agent-access", () => ({
  canManageCompanyOwnedAgent: vi.fn(() => true),
  normalizeVisibilityForCreation: vi.fn(() => "private"),
  resolveRuntimeOwnership: vi.fn(async () => null),
  getAgentAccessContext: vi.fn(async () => ({
    userId: "user-1",
    activeCompanyId: null,
    memberships: [],
  })),
}));

vi.mock("@/lib/workspace", () => ({
  isHeartbeatBearerRequest: vi.fn(async () => false),
  listWorkspaceAgents: (...args: unknown[]) => mockListWorkspaceAgents(...args),
  getAgentWorkspaceIds: (...args: unknown[]) => mockGetAgentWorkspaceIds(...args),
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
  grantAgentDefaultWorkspace: vi.fn(async () => null),
  grantAgentToWorkspace: vi.fn(async () => null),
}));

import { GET } from "./route";

function makeRequest(url = "http://localhost/api/agents") {
  const parsed = new URL(url);
  return {
    headers: {
      get: (_name: string) => null,
    },
    nextUrl: {
      searchParams: parsed.searchParams,
    },
  } as Parameters<typeof GET>[0];
}

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1" });
    mockListWorkspaceAgents.mockResolvedValue(mockAgents);
    mockGetAgentWorkspaceIds.mockResolvedValue(["ws-1"]);
    mockFromHeartbeats.mockResolvedValue([]);
  });

  it("returns agents with source 'db' when agents exist", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("db");
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].callsign).toBe("SCOUT");
    expect(body.agents[0].provider).toBe("anthropic");
  });

  it("returns source 'none' when no agents", async () => {
    mockListWorkspaceAgents.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("none");
    expect(body.agents).toHaveLength(0);
  });

  it("returns agents with heartbeat overlay when heartbeats exist", async () => {
    mockFromHeartbeats.mockResolvedValue([
      {
        callsign: "SCOUT",
        status: "busy",
        currentTask: "Deploying",
        lastActive: new Date("2026-04-02"),
        rawData: { tokenUsage: { input: 100, output: 50 } },
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.agents[0].status).toBe("busy");
    expect(body.agents[0].currentTask).toBe("Deploying");
    expect(body.agents[0].tokenUsage).toEqual({ input: 100, output: 50 });
  });
});
