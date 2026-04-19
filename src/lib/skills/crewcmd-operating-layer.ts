export const CREWCMD_OPERATING_LAYER_SKILL_METADATA = {
  kind: "service-skill",
  service: "crewcmd-operating-layer",
  version: 1,
  category: "operations",
  icon: "🧩",
  reviewSafeByDefault: true,
  auth: {
    type: "none",
  },
  openclaw: {
    requires: {
      env: [],
    },
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      rolePack: {
        type: "string",
        title: "Role pack",
      },
      mode: {
        type: "string",
        title: "Operating mode",
      },
      overlayContent: {
        type: "string",
        title: "CrewCmd operating overlay",
      },
      workspaceId: {
        type: "string",
        title: "Workspace ID",
      },
      runtimeId: {
        type: "string",
        title: "Runtime ID",
      },
    },
    required: ["rolePack", "mode", "overlayContent"],
  },
  configExample: {
    rolePack: "developer",
    mode: "imported-overlay",
    overlayContent: "CrewCmd operating overlay instructions",
  },
} as const;
