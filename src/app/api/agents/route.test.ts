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

const mockFromAgents = vi.fn();
const mockFromHeartbeats = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: symbol) => {
        // Route to different mocks based on call order
        if (table === Symbol.for("agents")) return mockFromAgents();
        if (table === Symbol.for("heartbeats")) return mockFromHeartbeats();
        // Fallback: first call is agents, subsequent are heartbeats
        return mockFromAgents();
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  agents: Symbol.for("agents"),
  agentHeartbeats: Symbol.for("heartbeats"),
}));

import { GET } from "./route";

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromAgents.mockResolvedValue(mockAgents);
    mockFromHeartbeats.mockResolvedValue([]);
  });

  it("returns agents with source 'db' when agents exist", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("db");
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].callsign).toBe("SCOUT");
    expect(body.agents[0].provider).toBe("anthropic");
  });

  it("returns source 'none' when no agents", async () => {
    mockFromAgents.mockResolvedValue([]);

    const res = await GET();
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

    const res = await GET();
    const body = await res.json();

    expect(body.agents[0].status).toBe("busy");
    expect(body.agents[0].currentTask).toBe("Deploying");
    expect(body.agents[0].tokenUsage).toEqual({ input: 100, output: 50 });
  });
});
