import { describe, expect, it } from "vitest";

import { generateCrewCmdOrchestratorSkill } from "./crewcmd-orchestrator-skill-template";
import { resolveRuntimeMainAgent } from "./runtime-main-agent";

describe("generateCrewCmdOrchestratorSkill", () => {
  it("renders delegate-first CEO instructions for the main agent", () => {
    const content = generateCrewCmdOrchestratorSkill({
      baseUrl: "https://crewcmd.example.com",
      workspaceId: "workspace_123",
      companyId: "company_123",
    });

    expect(content).toContain("name: crewcmd-orchestrator");
    expect(content).toContain("Act like the CEO/operator of the agent crew");
    expect(content).toContain("Delegate-first rule");
    expect(content).toContain("Delegate to the best-fit team member");
    expect(content).toContain("Only do the work yourself as a fallback");
    expect(content).toContain(
      "respond to the user first with a short acknowledgement and plan",
    );
    expect(content).toContain(
      "Use the crewcmd-management skill as the source of truth",
    );
    expect(content).toContain("workspace_123");
    expect(content).toContain("company_123");
  });
});

describe("resolveRuntimeMainAgent", () => {
  const agents = [
    {
      id: "agent_1",
      callsign: "cipher",
      name: "Cipher",
      title: "Engineer",
      runtimeRef: "cipher",
    },
    {
      id: "agent_2",
      callsign: "main",
      name: "Main",
      title: "Coordinator",
      runtimeRef: "main",
    },
    {
      id: "agent_3",
      callsign: "reviewer",
      name: "Reviewer",
      title: "Reviewer",
      runtimeRef: "reviewer",
    },
  ];

  it("prefers the runtime metadata default agent", () => {
    expect(
      resolveRuntimeMainAgent(agents, {
        metadata: { defaultAgentId: "cipher" },
      })?.id,
    ).toBe("agent_1");
  });

  it("falls back to the OpenClaw main runtime ref", () => {
    expect(resolveRuntimeMainAgent(agents, { metadata: {} })?.id).toBe(
      "agent_2",
    );
  });

  it("does not assign an orchestrator skill when no main-like agent exists", () => {
    expect(
      resolveRuntimeMainAgent(
        [
          {
            id: "agent_1",
            callsign: "cipher",
            name: "Cipher",
            title: "Engineer",
            runtimeRef: "cipher",
          },
        ],
        { metadata: {} },
      ),
    ).toBeNull();
  });
});
