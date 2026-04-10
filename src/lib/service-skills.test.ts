import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgentsFrom,
  mockSkillsWhere,
  mockAgentSkillsWhere,
  mockSecretWhere,
  agentsTable,
  skillsTable,
  agentSkillsTable,
  serviceSecretsTable,
} = vi.hoisted(() => ({
  mockAgentsFrom: vi.fn(),
  mockSkillsWhere: vi.fn(),
  mockAgentSkillsWhere: vi.fn(),
  mockSecretWhere: vi.fn(),
  agentsTable: { __table: Symbol.for("agents") },
  skillsTable: {
    __table: Symbol.for("skills"),
    id: Symbol.for("skills.id"),
    companyId: Symbol.for("skills.companyId"),
    slug: Symbol.for("skills.slug"),
  },
  agentSkillsTable: {
    __table: Symbol.for("agentSkills"),
    agentId: Symbol.for("agentSkills.agentId"),
    skillId: Symbol.for("agentSkills.skillId"),
  },
  serviceSecretsTable: {
    __table: Symbol.for("serviceSecrets"),
    value: Symbol.for("serviceSecrets.value"),
    companyId: Symbol.for("serviceSecrets.companyId"),
    name: Symbol.for("serviceSecrets.name"),
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: { __table?: symbol }) => {
        if (table === agentsTable) {
          return mockAgentsFrom();
        }
        if (table === skillsTable) {
          return { where: mockSkillsWhere };
        }
        if (table === agentSkillsTable) {
          return { where: mockAgentSkillsWhere };
        }
        if (table === serviceSecretsTable) {
          return { where: mockSecretWhere };
        }
        return { where: vi.fn() };
      },
    }),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/db/schema", () => ({
  agents: agentsTable,
  skills: skillsTable,
  agentSkills: agentSkillsTable,
  serviceSecrets: serviceSecretsTable,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

import { invokeServiceSkill } from "@/lib/service-skills";

describe("invokeServiceSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAgentsFrom.mockResolvedValue([
      { id: "agent_1", callsign: "Cipher", companyId: "co_1" },
    ]);

    mockSkillsWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        {
          id: "skill_1",
          slug: "evercontent",
          metadata: {
            kind: "service-skill",
            service: "evercontent",
            capabilities: ["posts:list", "posts:publish"],
          },
        },
      ]),
    });

    mockAgentSkillsWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        {
          id: "assign_1",
          enabled: true,
          config: {
            baseUrl: "https://app.evercontent.com",
            secretRef: { name: "evercontent-api-key" },
            allowedProjectIds: ["project_456"],
            canPublish: false,
          },
        },
      ]),
    });

    mockSecretWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ value: "secret_123" }]),
    });
  });

  it("invokes EverContent list posts inside allowed scope", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ items: [{ id: "post_1" }] }),
    } as unknown as Response);

    const result = await invokeServiceSkill({
      agentCallsign: "cipher",
      skillSlug: "evercontent",
      action: "posts.list",
      input: { projectId: "project_456" },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ items: [{ id: "post_1" }] });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://app.evercontent.io/api/projects/project_456/posts",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "secret_123" }),
      })
    );
  });

  it("blocks requests outside allowed project scope", async () => {
    const result = await invokeServiceSkill({
      agentCallsign: "cipher",
      skillSlug: "evercontent",
      action: "posts.list",
      input: { projectId: "project_999" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the allowed project scope");
  });

  it("blocks publish when canPublish is false", async () => {
    const result = await invokeServiceSkill({
      agentCallsign: "cipher",
      skillSlug: "evercontent",
      action: "posts.publish",
      input: { postId: "post_1" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Publishing is disabled");
  });
});
