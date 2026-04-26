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
      { id: "cipher", workspace: "/workspace/agents/cipher", agentDir: "/runtime/agents/cipher/agent" },
      { id: "forge", workspace: "/workspace/agents/forge", agentDir: "/runtime/agents/forge/agent" },
    ]);
    expect(patch.acp).toEqual({
      enabled: true,
      defaultAgent: "openclaw",
      allowedAgents: ["openclaw", "cipher", "forge"],
    });
  });
});
