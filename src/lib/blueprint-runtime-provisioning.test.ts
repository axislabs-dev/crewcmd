import { describe, expect, it } from "vitest";
import { buildBlueprintRuntimeConfigPatch } from "./blueprint-runtime-provisioning";
import type { BlueprintAgentTemplate } from "@/db/schema";

function agent(overrides: Partial<BlueprintAgentTemplate> = {}): BlueprintAgentTemplate {
  return {
    name: "Cipher",
    callsign: "Cipher",
    title: "Engineer",
    role: "engineer",
    rolePack: "engineer",
    emoji: "🤖",
    color: "#00f0ff",
    adapterType: "codex_local",
    model: "openai/gpt-5",
    modelProfile: undefined,
    fallbackProfiles: [],
    skills: ["crewcmd-management"],
    reportsTo: undefined,
    identityContent: undefined,
    soulContent: undefined,
    agentsContent: undefined,
    userContent: undefined,
    toolsContent: undefined,
    heartbeatContent: undefined,
    bootstrapContent: undefined,
    promptTemplate: undefined,
    ...overrides,
  };
}

describe("buildBlueprintRuntimeConfigPatch", () => {
  it("uses OpenClaw's default agent directory when no agent list exists yet", () => {
    const patch = buildBlueprintRuntimeConfigPatch({
      config: {
        agents: {
          defaults: { workspace: "/workspace" },
        },
      },
      agentTemplates: [agent({ callsign: "Cipher" })],
      runtimeCapabilities: null,
    });

    expect(patch.agents.list).toEqual([
      expect.objectContaining({
        id: "cipher",
        workspace: "/workspace/agents/cipher",
      }),
    ]);
    expect(patch.agents.list[0]).not.toHaveProperty("agentDir");
  });

  it("adds provisioned blueprint agents to the OpenClaw agent list and ACP allowlist", () => {
    const patch = buildBlueprintRuntimeConfigPatch({
      config: {
        agents: {
          defaults: { workspace: "/workspace" },
          list: [{ id: "main", agentDir: "/runtime/agents/main/agent" }],
        },
        acp: {
          enabled: true,
          defaultAgent: "openclaw",
          allowedAgents: ["openclaw", "cipher"],
        },
      },
      agentTemplates: [agent({ callsign: "Cipher" }), agent({ callsign: "Forge" })],
      runtimeCapabilities: null,
    });

    expect(patch.agents.list).toMatchObject([
      { id: "main", agentDir: "/runtime/agents/main/agent" },
      { id: "cipher", workspace: "/workspace/agents/cipher", agentDir: "/runtime/agents/cipher/agent" },
      { id: "forge", workspace: "/workspace/agents/forge", agentDir: "/runtime/agents/forge/agent" },
    ]);
    expect(patch.acp).toEqual({
      enabled: true,
      defaultAgent: "openclaw",
      allowedAgents: ["openclaw", "cipher", "forge"],
    });
  });

  it("maps blueprint reportsTo relationships into OpenClaw subagent allowlists", () => {
    const patch = buildBlueprintRuntimeConfigPatch({
      config: {
        agents: {
          defaults: { workspace: "/workspace" },
          list: [{ id: "main", agentDir: "/runtime/agents/main/agent" }],
        },
        acp: {
          enabled: true,
          allowedAgents: ["main"],
        },
      },
      agentTemplates: [
        agent({ callsign: "Atlas" }),
        agent({ callsign: "Pixel", reportsTo: "ATLAS" }),
        agent({ callsign: "Test Forge", reportsTo: "ATLAS" }),
      ],
      runtimeCapabilities: null,
    });

    expect(patch.agents.list).toContainEqual(
      expect.objectContaining({
        id: "atlas",
        subagents: {
          allowAgents: ["pixel", "test-forge"],
        },
      })
    );
    expect(patch.agents.list).toContainEqual(
      expect.objectContaining({
        id: "pixel",
      })
    );
    expect(
      patch.agents.list.find((entry) => entry.id === "pixel")
    ).not.toHaveProperty("subagents");
  });

  it("preserves existing runtime agents when adding blueprint agents", () => {
    const patch = buildBlueprintRuntimeConfigPatch({
      config: {
        agents: {
          defaults: { workspace: "/workspace" },
          list: [
            {
              id: "main",
              name: "main",
              workspace: "/workspace/agents/main",
              agentDir: "/runtime/agents/main/agent",
              skills: ["existing-skill"],
            },
            {
              id: "support",
              name: "support",
              workspace: "/workspace/agents/support",
              agentDir: "/runtime/agents/support/agent",
            },
          ],
        },
        acp: {
          enabled: true,
          allowedAgents: ["main"],
        },
      },
      agentTemplates: [agent({ callsign: "Cipher" })],
      runtimeCapabilities: null,
    });

    expect(patch.agents.list).toMatchObject([
      {
        id: "main",
        name: "main",
        workspace: "/workspace/agents/main",
        agentDir: "/runtime/agents/main/agent",
        skills: ["existing-skill"],
      },
      {
        id: "support",
        name: "support",
        workspace: "/workspace/agents/support",
        agentDir: "/runtime/agents/support/agent",
      },
      {
        id: "cipher",
        name: "cipher",
        workspace: "/workspace/agents/cipher",
        agentDir: "/runtime/agents/cipher/agent",
      },
    ]);
    expect(patch.acp.allowedAgents).toEqual(["main", "cipher"]);
  });

  it("upserts blueprint agents without duplicating existing runtime ids", () => {
    const patch = buildBlueprintRuntimeConfigPatch({
      config: {
        agents: {
          defaults: { workspace: "/workspace" },
          list: [
            {
              id: "cipher",
              name: "old-cipher",
              workspace: "/workspace/agents/cipher-old",
              agentDir: "/runtime/agents/cipher/agent",
              skills: ["old-skill"],
            },
          ],
        },
        acp: {
          enabled: false,
          allowedAgents: [],
        },
      },
      agentTemplates: [agent({ callsign: "Cipher", skills: ["crewcmd-management", "crewcmd-management"] })],
      runtimeCapabilities: null,
    });

    expect(patch.agents.list).toHaveLength(1);
    expect(patch.agents.list[0]).toMatchObject({
      id: "cipher",
      name: "cipher",
      workspace: "/workspace/agents/cipher",
      agentDir: "/runtime/agents/cipher/agent",
      skills: ["crewcmd-management"],
    });
    expect(patch.acp).toEqual({
      enabled: true,
      allowedAgents: ["cipher"],
    });
  });
});
