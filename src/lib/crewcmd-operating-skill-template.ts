interface CrewCmdOperatingSkillConfig {
  rolePack: string;
  mode: string;
  overlayContent: string;
}

export function generateCrewCmdOperatingLayerSkill(
  config: CrewCmdOperatingSkillConfig
): string {
  return `---
name: crewcmd-operating-layer
description: CrewCmd operating overlay for imported and blueprint-managed agents.
version: "0.1.1"
---

# CrewCmd Operating Layer

Mode: ${config.mode}
Role pack: ${config.rolePack}

This skill defines the CrewCmd operating contract layered onto this agent. It does not replace the agent's own identity unless this is a CrewCmd-owned blueprint agent.

## Required behavior

${config.overlayContent}
`;
}
