import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const agents = { id: "agents.id" };
  const agentSkills = {
    agentId: "agentSkills.agentId",
    skillId: "agentSkills.skillId",
  };
  const skills = {
    id: "skills.id",
    workspaceId: "skills.workspaceId",
    companyId: "skills.companyId",
  };

  return {
    agents,
    agentSkills,
    skills,
    allAgents: vi.fn(),
    assignedSkills: vi.fn(),
    allSkills: vi.fn(),
    skillLookup: vi.fn(),
    insertValues: vi.fn(),
    canReadAgent: vi.fn(),
    canUpdateAgent: vi.fn(),
    getAgentAccessContext: vi.fn(),
  };
});

vi.mock("@/db/schema", () => ({
  agents: mocks.agents,
  agentSkills: mocks.agentSkills,
  skills: mocks.skills,
}));

vi.mock("@/db", () => ({
  db: {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === mocks.agents) {
          return mocks.allAgents();
        }
        if (table === mocks.agentSkills) {
          return { where: mocks.assignedSkills };
        }
        if (table === mocks.skills && selection?.id) {
          return { where: () => ({ limit: mocks.skillLookup }) };
        }
        if (table === mocks.skills) {
          return mocks.allSkills();
        }
        throw new Error("Unexpected table");
      },
    }),
    insert: () => ({ values: mocks.insertValues }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
}));

vi.mock("@/lib/agent-access", () => ({
  canReadAgent: (...args: unknown[]) => mocks.canReadAgent(...args),
  canUpdateAgent: (...args: unknown[]) => mocks.canUpdateAgent(...args),
  getAgentAccessContext: (...args: unknown[]) => mocks.getAgentAccessContext(...args),
}));

vi.mock("@/lib/service-secrets", () => ({
  validateSkillConfigSecretRefs: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/push-secrets-to-gateway", () => ({
  pushSecretsToGateway: vi.fn(),
}));

vi.mock("@/lib/sync-skill-to-openclaw", () => ({
  syncSkillToOpenClaw: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveRuntimeWorkspace: vi.fn(async () => null),
}));

import { GET, POST } from "./route";

const agent = {
  id: "agent-1",
  callsign: "Scout",
  ownerType: "user",
  ownerUserId: "user-1",
  ownerCompanyId: null,
  visibility: "private",
};

function params(callsign = "scout") {
  return { params: Promise.resolve({ callsign }) };
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/agents/scout/skills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/agents/[callsign]/skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allAgents.mockResolvedValue([agent]);
    mocks.assignedSkills.mockResolvedValue([{ id: "assignment-1", agentId: "agent-1", skillId: "skill-1", config: null }]);
    mocks.allSkills.mockResolvedValue([{ id: "skill-1", name: "Skill" }]);
    mocks.skillLookup.mockResolvedValue([{ id: "skill-1", workspaceId: null, companyId: null }]);
    mocks.insertValues.mockReturnValue({
      returning: () => Promise.resolve([{ id: "assignment-1", agentId: "agent-1", skillId: "skill-1" }]),
    });
    mocks.getAgentAccessContext.mockResolvedValue({ userId: "user-1", memberships: [], activeCompanyId: null });
    mocks.canReadAgent.mockReturnValue(true);
    mocks.canUpdateAgent.mockReturnValue(true);
  });

  it("hides skill assignments when the caller cannot read the agent", async () => {
    mocks.canReadAgent.mockReturnValue(false);

    const res = await GET(new NextRequest("http://localhost:3000/api/agents/scout/skills"), params());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Agent not found");
    expect(mocks.assignedSkills).not.toHaveBeenCalled();
  });

  it("blocks attaching a skill when the caller cannot update the agent", async () => {
    mocks.canUpdateAgent.mockReturnValue(false);

    const res = await POST(makePostRequest({ skillId: "skill-1" }), params());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("attaches a skill when the caller can update the agent", async () => {
    const res = await POST(makePostRequest({ skillId: "skill-1", enabled: true }), params());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ agentId: "agent-1", skillId: "skill-1" });
    expect(mocks.insertValues).toHaveBeenCalledWith({
      agentId: "agent-1",
      skillId: "skill-1",
      enabled: true,
      config: {},
    });
  });
});
