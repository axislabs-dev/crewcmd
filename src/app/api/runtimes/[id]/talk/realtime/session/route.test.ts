import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeRow = {
  id: string;
  ownerUserId: string | null;
};

type AgentRow = {
  id: string;
  callsign: string;
};

type ChannelMemberRow = {
  id: string;
  channelId: string;
  memberType: "user" | "agent";
  agentId: string | null;
  role: string;
  agentParticipationMode: string | null;
};

type ChannelRow = {
  id: string;
  type: "channel" | "dm";
};

type DbRow = RuntimeRow | AgentRow | ChannelMemberRow | ChannelRow;
type Field = { table: string; key: string };
type Predicate = (row: DbRow) => boolean;

const { mockRuntimeRows, mockAgentRows, mockChannelRows, mockChannelMemberRows, mockGetGatewayClientForRuntime } = vi.hoisted(() => ({
  mockRuntimeRows: [] as RuntimeRow[],
  mockAgentRows: [] as AgentRow[],
  mockChannelRows: [] as ChannelRow[],
  mockChannelMemberRows: [] as ChannelMemberRow[],
  mockGetGatewayClientForRuntime: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  companyRuntimes: {
    __table: "companyRuntimes",
    id: { table: "companyRuntimes", key: "id" },
    ownerUserId: { table: "companyRuntimes", key: "ownerUserId" },
  },
  agents: {
    __table: "agents",
    id: { table: "agents", key: "id" },
    callsign: { table: "agents", key: "callsign" },
  },
  channels: {
    __table: "channels",
    id: { table: "channels", key: "id" },
    type: { table: "channels", key: "type" },
  },
  channelMembers: {
    __table: "channelMembers",
    id: { table: "channelMembers", key: "id" },
    channelId: { table: "channelMembers", key: "channelId" },
    memberType: { table: "channelMembers", key: "memberType" },
    agentId: { table: "channelMembers", key: "agentId" },
    role: { table: "channelMembers", key: "role" },
    agentParticipationMode: { table: "channelMembers", key: "agentParticipationMode" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: Field, value: unknown): Predicate => (row) => (row as Record<string, unknown>)[field.key] === value,
  and: (...predicates: Array<Predicate | undefined>): Predicate => (row) =>
    predicates.every((predicate) => predicate?.(row) ?? true),
}));

function rowsForTable(table: { __table: string }) {
  if (table.__table === "companyRuntimes") return mockRuntimeRows;
  if (table.__table === "agents") return mockAgentRows;
  if (table.__table === "channels") return mockChannelRows;
  if (table.__table === "channelMembers") return mockChannelMemberRows;
  return [];
}

function projectRows(rows: DbRow[], selection: Record<string, Field>) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(selection).map(([key, field]) => [
        key,
        (row as Record<string, unknown>)[field.key],
      ]),
    ),
  );
}

vi.mock("@/db", () => ({
  db: {
    select: (selection: Record<string, Field>) => ({
      from: (table: { __table: string }) => ({
        where: (predicate: Predicate) => ({
          limit: (count: number) =>
            Promise.resolve(projectRows(rowsForTable(table).filter(predicate).slice(0, count), selection)),
        }),
      }),
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  getAgentAccessContext: () => ({ userId: "user_1", activeCompanyId: null, memberships: [] }),
  buildRuntimeReadWhere: () => (row: DbRow) => (row as RuntimeRow).ownerUserId === "user_1",
}));

vi.mock("@/lib/gateway-chat-pool", () => ({
  getGatewayClientForRuntime: (...args: unknown[]) => mockGetGatewayClientForRuntime(...args),
}));

import { GET, POST } from "./route";

describe("/api/runtimes/[id]/talk/realtime/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockRuntimeRows.length = 0;
    mockAgentRows.length = 0;
    mockChannelRows.length = 0;
    mockChannelMemberRows.length = 0;
  });

  it("reports disabled readiness without contacting OpenClaw", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREWCMD_REALTIME_VOICE", "0");
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });

    const response = await GET(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session"),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      readiness: {
        status: "disabled",
        fallback: "classic-stt-tts",
      },
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });

  it("derives current OpenClaw readiness for the requested provider", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREWCMD_REALTIME_VOICE", "1");
    const talkCatalog = vi.fn().mockResolvedValue({
      realtime: {
        ready: true,
        activeProvider: "openai-realtime",
        providers: [{
          id: "openai-realtime",
          aliases: ["openai"],
          label: "OpenAI Realtime Voice",
          configured: true,
          transports: ["webrtc", "gateway-relay"],
        }],
      },
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ talkCatalog });

    const response = await GET(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session?provider=openai"),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      readiness: {
        status: "ready",
        provider: "openai-realtime",
        protocolVerified: true,
      },
    });
    expect(talkCatalog).toHaveBeenCalledOnce();
  });

  it("returns a secret-free unreachable readiness result", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREWCMD_REALTIME_VOICE", "1");
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockRejectedValue(
      new Error("connection failed with token super-secret"),
    );

    const response = await GET(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session"),
      { params: Promise.resolve({ id: "rt_1" }) },
    );
    const body = await response.json();

    expect(body).toMatchObject({
      readiness: {
        status: "unreachable",
        fallback: "classic-stt-tts",
      },
    });
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });

  it("proxies realtime talk session requests through an accessible runtime", async () => {
    const realtimeTalkSession = vi.fn().mockResolvedValue({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: " main ",
          provider: "openai",
          model: "gpt-realtime-1.5",
          voice: "marin",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: {
        transport: "gateway-relay",
        relaySessionId: "relay_1",
      },
    });
    expect(realtimeTalkSession).toHaveBeenCalledWith({
      sessionKey: "main",
      provider: "openai",
      model: "gpt-realtime-1.5",
      voice: "marin",
      agentId: undefined,
      transport: "gateway-relay",
      vadThreshold: undefined,
      silenceDurationMs: 2000,
      prefixPaddingMs: 500,
    });
  });

  it("allows realtime VAD tuning overrides", async () => {
    const realtimeTalkSession = vi.fn().mockResolvedValue({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          silenceDurationMs: 2400,
          prefixPaddingMs: 650,
          vadThreshold: 0.45,
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    expect(realtimeTalkSession).toHaveBeenCalledWith(expect.objectContaining({
      silenceDurationMs: 2400,
      prefixPaddingMs: 650,
      vadThreshold: 0.45,
    }));
  });

  it("rejects channel-scoped realtime sessions for agents outside the channel", async () => {
    const realtimeTalkSession = vi.fn();
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockAgentRows.push({ id: "agent_1", callsign: "neo" });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          agentId: "main",
          channelAgentId: "neo",
          channelId: "channel_crew",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Agent is not a member of this channel.",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
    expect(realtimeTalkSession).not.toHaveBeenCalled();
  });

  it("allows channel-scoped realtime sessions for eligible channel agents", async () => {
    const realtimeTalkSession = vi.fn().mockResolvedValue({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockAgentRows.push({ id: "agent_1", callsign: "neo" });
    mockChannelRows.push({ id: "channel_crew", type: "channel" });
    mockChannelMemberRows.push({
      id: "member_1",
      channelId: "channel_crew",
      memberType: "agent",
      agentId: "agent_1",
      role: "member",
      agentParticipationMode: "on_call",
    });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: "main",
          agentId: "main",
          channelAgentId: "neo",
          channelId: "channel_crew",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    expect(realtimeTalkSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "main",
      sessionKey: "main",
    }));
  });

  it("rejects mention-only agents for shared-channel realtime sessions", async () => {
    const realtimeTalkSession = vi.fn();
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockAgentRows.push({ id: "agent_1", callsign: "neo" });
    mockChannelRows.push({ id: "channel_crew", type: "channel" });
    mockChannelMemberRows.push({
      id: "member_1",
      channelId: "channel_crew",
      memberType: "agent",
      agentId: "agent_1",
      role: "member",
      agentParticipationMode: "mention_only",
    });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: "main",
          agentId: "main",
          channelAgentId: "neo",
          channelId: "channel_crew",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Agent is not an active participant in this channel.",
    });
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
    expect(realtimeTalkSession).not.toHaveBeenCalled();
  });

  it("allows direct agent DM realtime sessions even when the stored mode is mention-only", async () => {
    const realtimeTalkSession = vi.fn().mockResolvedValue({
      transport: "gateway-relay",
      relaySessionId: "relay_1",
    });
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_1" });
    mockAgentRows.push({ id: "agent_1", callsign: "neo" });
    mockChannelRows.push({ id: "dm_neo", type: "dm" });
    mockChannelMemberRows.push({
      id: "member_1",
      channelId: "dm_neo",
      memberType: "agent",
      agentId: "agent_1",
      role: "member",
      agentParticipationMode: "mention_only",
    });
    mockGetGatewayClientForRuntime.mockResolvedValue({ realtimeTalkSession });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", {
        method: "POST",
        body: JSON.stringify({
          sessionKey: "main",
          agentId: "main",
          channelAgentId: "neo",
          channelId: "dm_neo",
        }),
      }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(200);
    expect(realtimeTalkSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "main",
      sessionKey: "main",
    }));
  });

  it("does not call the gateway for unreadable runtimes", async () => {
    mockRuntimeRows.push({ id: "rt_1", ownerUserId: "user_2" });

    const response = await POST(
      new Request("http://localhost/api/runtimes/rt_1/talk/realtime/session", { method: "POST" }),
      { params: Promise.resolve({ id: "rt_1" }) },
    );

    expect(response.status).toBe(404);
    expect(mockGetGatewayClientForRuntime).not.toHaveBeenCalled();
  });
});
