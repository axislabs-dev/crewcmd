import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const tables = {
    agents: { id: Symbol("agents.id"), runtimeId: Symbol("agents.runtimeId") },
    skills: { id: Symbol("skills.id"), companyId: Symbol("skills.companyId"), workspaceId: Symbol("skills.workspaceId") },
    agentSkills: { agentId: Symbol("agentSkills.agentId"), skillId: Symbol("agentSkills.skillId") },
    companyRuntimes: { id: Symbol("companyRuntimes.id") },
  };

  return {
    tables,
    rows: {
      agent: null as Record<string, unknown> | null,
      skill: null as Record<string, unknown> | null,
      assignment: null as Record<string, unknown> | null,
      runtime: null as Record<string, unknown> | null,
    },
    gateway: {
      calls: [] as Array<{ method: string; params?: unknown }>,
      config: {
        hash: "hash-1",
        config: {
          agents: { list: [{ id: "cipher", skills: ["existing"] }] },
          skills: { entries: {} },
        },
      },
      installResult: { ok: true, installed: true, slug: "calendar", version: "1.2.3", path: "/Users/testuser/.openclaw/skills/calendar" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
}));

vi.mock("@/db/schema", () => state.tables);

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === state.tables.agents) return state.rows.agent ? [state.rows.agent] : [];
            if (table === state.tables.skills) return state.rows.skill ? [state.rows.skill] : [];
            if (table === state.tables.agentSkills) return state.rows.assignment ? [state.rows.assignment] : [];
            if (table === state.tables.companyRuntimes) return state.rows.runtime ? [state.rows.runtime] : [];
            return [];
          },
        }),
      }),
    }),
  },
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/service-secrets", () => ({
  collectSecretRefNames: () => new Set<string>(),
  resolveSecretRef: vi.fn(),
}));

vi.mock("@/lib/heartbeat-secret", () => ({
  getHeartbeatSecret: vi.fn(async () => "heartbeat-secret"),
}));

vi.mock("@/lib/gateway-client", () => ({
  resolveDeviceIdentity: () => ({ deviceId: "device", publicKeyRawBase64Url: "pub", privateKeyPem: "pem", source: "configured" }),
  GatewayClient: class MockGatewayClient {
    constructor() {}
    async connect() { state.gateway.calls.push({ method: "connect" }); return { version: "test" }; }
    async skillsInstall(params: unknown) { state.gateway.calls.push({ method: "skills.install", params }); return state.gateway.installResult; }
    async configGet() { state.gateway.calls.push({ method: "config.get" }); return state.gateway.config; }
    async configPatch(params: unknown) { state.gateway.calls.push({ method: "config.patch", params }); return { ok: true }; }
    async skillsUpdate(params: unknown) { state.gateway.calls.push({ method: "skills.update", params }); return { ok: true }; }
    close() { state.gateway.calls.push({ method: "close" }); }
  },
}));

import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";

describe("syncSkillToOpenClaw native ClawHub install", () => {
  beforeEach(() => {
    state.gateway.calls = [];
    state.gateway.installResult = { ok: true, installed: true, slug: "calendar", version: "1.2.3", path: "/Users/testuser/.openclaw/skills/calendar" };
    state.gateway.config = {
      hash: "hash-1",
      config: {
        agents: { list: [{ id: "cipher", skills: ["existing"] }] },
        skills: { entries: {} },
      },
    };
    state.rows.agent = { id: "agent-1", runtimeId: "runtime-1", runtimeRef: "cipher" };
    state.rows.skill = {
      id: "skill-1",
      workspaceId: "workspace-1",
      companyId: "company-1",
      name: "Calendar",
      slug: "calendar",
      description: "Calendar skill",
      source: "clawhub",
      sourceUrl: "https://clawhub.ai/skills/calendar",
      version: "1.2.3",
      content: "Use the calendar.",
      metadata: {
        provider: { id: "clawhub", skillId: "calendar", version: "1.2.3", registryUrl: "https://clawhub.ai" },
        auth: { type: "none" },
      },
    };
    state.rows.assignment = { agentId: "agent-1", skillId: "skill-1", enabled: true, config: { color: "blue" } };
    state.rows.runtime = { id: "runtime-1", gatewayUrl: "ws://gateway", authToken: "token", metadata: { devicePrivateKeyPem: "pem" } };
  });

  it("installs a ClawHub catalog skill through the OpenClaw gateway and reflects it in config", async () => {
    const result = await syncSkillToOpenClaw({ skillId: "skill-1", agentId: "agent-1", companyId: "company-1" });

    expect(result.success).toBe(true);
    expect(result.nativeInstall).toEqual({
      provider: "clawhub",
      slug: "calendar",
      version: "1.2.3",
      installed: true,
      warnings: [],
    });

    expect(state.gateway.calls.find((call) => call.method === "skills.install")?.params).toEqual({
      source: "clawhub",
      slug: "calendar",
      version: "1.2.3",
    });
    expect(state.gateway.calls.find((call) => call.method === "config.patch")?.params).toMatchObject({
      patch: {
        agents: { list: [{ id: "cipher", skills: ["existing", "calendar"] }] },
        skills: { entries: { calendar: { enabled: true, config: { color: "blue" } } } },
      },
      baseHash: "hash-1",
    });
    expect(state.gateway.calls.find((call) => call.method === "skills.update")?.params).toEqual({
      skillKey: "calendar",
      enabled: true,
    });
  });
});
