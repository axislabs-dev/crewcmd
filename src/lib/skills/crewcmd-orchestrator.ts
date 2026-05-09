export const CREWCMD_ORCHESTRATOR_SKILL_METADATA = {
  kind: "instruction-skill",
  service: "crewcmd-orchestrator",
  version: 1,
  category: "operations",
  icon: "🧑‍✈️",
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
      baseUrl: {
        type: "string",
        title: "CrewCmd base URL",
      },
      companyId: {
        type: "string",
        title: "Company ID",
      },
      workspaceId: {
        type: "string",
        title: "Workspace ID",
      },
      runtimeId: {
        type: "string",
        title: "Runtime ID",
      },
      role: {
        type: "string",
        title: "Main agent role",
      },
      delegationMode: {
        type: "string",
        title: "Delegation mode",
      },
    },
    required: ["baseUrl", "workspaceId", "runtimeId"],
  },
  configExample: {
    baseUrl: "https://crewcmd.example.com",
    companyId: "company_123",
    workspaceId: "workspace_123",
    runtimeId: "runtime_123",
    role: "CEO",
    delegationMode: "delegate-first",
  },
} as const;
