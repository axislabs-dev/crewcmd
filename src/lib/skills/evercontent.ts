export interface InstallableSkillTemplate {
  name: string;
  slug: string;
  description: string;
  source: string;
  version: string;
  sourceUrl: string;
  content: string;
  metadata: Record<string, unknown>;
}

export const EVERCONTENT_SKILL_TEMPLATE: InstallableSkillTemplate = {
  name: "EverContent",
  slug: "evercontent",
  description:
    "Create, review, and manage EverContent drafts with scoped project access and publish disabled by default.",
  source: "system",
  version: "0.1.0",
  sourceUrl: "https://evercontent.co",
  content: `# EverContent Skill

Use EverContent to discover customers/projects and create or update draft blog content.

## Intended use
- Default to review-safe behavior.
- Draft and save content unless publish permission is explicitly enabled.
- Respect the assignment config scope. Do not operate outside allowed customers/projects.
- Never request or store raw API keys in messages or markdown. Use the configured \`secretRef\`.

## Assignment config
This skill expects per-agent config in \`agent_skills.config\`.

Example:
\`\`\`json
{
  "baseUrl": "https://app.evercontent.com",
  "secretRef": { "name": "evercontent-api-key" },
  "allowedProjectIds": ["project_456"],
  "canPublish": false
}
\`\`\`

Common fields:
- \`baseUrl\`: EverContent base URL
- \`secretRef\`: company secret reference for the EverContent API key
- \`defaultCustomerId\`: optional default customer scope
- \`defaultProjectId\`: optional default project scope
- \`allowedCustomerIds\`: optional allow-list of customer IDs
- \`allowedProjectIds\`: optional allow-list of project IDs
- \`defaultScope\`: one of \`customer\` or \`project\`
- \`canPublish\`: defaults to \`false\`; only publish when explicitly enabled

## Capability contract
Supported actions:
- \`customers.list\`
- \`projects.list\`
- \`posts.list\`
- \`posts.get\`
- \`posts.create\`
- \`posts.update\`
- \`posts.save\`
- \`posts.publish\` (only when \`canPublish\` is \`true\`)

## Guardrails
- Treat publish as a privileged action.
- If \`canPublish\` is not true, stop at draft/save and explain that publish is disabled.
- Prefer project-scoped operations when a project ID is available.
- Keep output concise and operational: identify project, draft status, and next step for review.
`,
  metadata: {
    kind: "service-skill",
    service: "evercontent",
    version: 1,
    category: "content",
    icon: "📝",
    reviewSafeByDefault: true,
    auth: {
      type: "header-api-key",
      header: "x-api-key",
      secretRefField: "secretRef",
    },
    capabilities: [
      "customers:list",
      "projects:list",
      "posts:list",
      "posts:get",
      "posts:create",
      "posts:update",
      "posts:save",
      "posts:publish",
    ],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        baseUrl: {
          type: "string",
          title: "EverContent base URL",
          description: "Workspace URL, e.g. https://app.evercontent.com",
        },
        secretRef: {
          type: "object",
          title: "EverContent API key",
          description: "Vault-backed company secret containing the EverContent API key",
          additionalProperties: false,
          properties: {
            name: { type: "string", title: "Secret name" },
          },
          required: ["name"],
        },
        defaultCustomerId: { type: "string", title: "Default customer ID" },
        defaultProjectId: { type: "string", title: "Default project ID" },
        allowedCustomerIds: {
          type: "array",
          title: "Allowed customer IDs",
          items: { type: "string" },
        },
        allowedProjectIds: {
          type: "array",
          title: "Allowed project IDs",
          items: { type: "string" },
        },
        defaultScope: {
          type: "string",
          title: "Default scope",
          description: "Choose the default lookup scope for this agent",
          enum: ["customer", "project"],
          default: "project",
        },
        canPublish: {
          type: "boolean",
          title: "Allow publish",
          default: false,
          description: "Leave false for review-safe draft workflows",
        },
      },
      required: ["baseUrl", "secretRef"],
    },
    configExample: {
      baseUrl: "https://app.evercontent.com",
      secretRef: { name: "evercontent-api-key" },
      defaultScope: "project",
      allowedProjectIds: ["project_456"],
      canPublish: false,
    },
  },
};
