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
  version: "0.2.0",
  sourceUrl: "https://evercontent.co",
  content: `# EverContent Skill

Use EverContent directly from OpenClaw to discover projects, inspect posts, create drafts, update content, and publish only when explicitly enabled.

## Runtime contract
This is a native OpenClaw skill.

Read auth and policy from the active OpenClaw config:

\`\`\`json
{
  "skills": {
    "entries": {
      "evercontent": {
        "enabled": true,
        "apiKey": "ec_...",
        "config": {
          "defaultCustomerId": "customer_123",
          "defaultProjectId": "project_456",
          "allowedCustomerIds": ["customer_123"],
          "allowedProjectIds": ["project_456"],
          "defaultScope": "project",
          "canPublish": false
        }
      }
    }
  }
}
\`\`\`

Use these values:
- \`skills.entries.evercontent.apiKey\` for auth
- \`skills.entries.evercontent.config\` for scope and publish policy

## Config fields
- \`defaultCustomerId\`: optional default customer scope
- \`defaultProjectId\`: optional default project scope
- \`allowedCustomerIds\`: optional allow-list of customer IDs
- \`allowedProjectIds\`: optional allow-list of project IDs
- \`defaultScope\`: one of \`customer\` or \`project\`
- \`canPublish\`: defaults to \`false\`; only publish when explicitly enabled

## Auth setup
Resolve config before making requests:

\`\`\`bash
CONFIG_PATH="\${OPENCLAW_CONFIG_PATH:-\${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
EVERCONTENT_API_KEY=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.skills.entries["evercontent"].apiKey // empty')
\`\`\`

If \`EVERCONTENT_API_KEY\` is empty, stop and say EverContent is not configured.

Base URL:

\`\`\`
https://app.evercontent.io
\`\`\`

Auth header for all requests:

\`\`\`bash
curl -s -H "x-api-key: $EVERCONTENT_API_KEY" -H "content-type: application/json" ...
\`\`\`

## Supported operations
- \`projects.list\`
- \`posts.list\`
- \`posts.get\`
- \`posts.create\`
- \`posts.publish\` (only when \`canPublish\` is \`true\`)

## API patterns
List projects:

\`\`\`bash
curl -s -H "x-api-key: $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/projects"
\`\`\`

List projects for a customer:

\`\`\`bash
curl -s -H "x-api-key: $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/customer/projects?customerId=CUSTOMER_ID"
\`\`\`

List posts for a project:

\`\`\`bash
curl -s -H "x-api-key: $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/projects/PROJECT_ID/posts"
\`\`\`

Get a post:

\`\`\`bash
curl -s -H "x-api-key: $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/projects/PROJECT_ID/posts/POST_ID"
\`\`\`

Create a draft post:

\`\`\`bash
curl -s -X POST \\
  -H "x-api-key: $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "title": "Draft title",
    "brief": "Short brief",
    "contentMarkdown": "# Draft content",
    "keywords": ["keyword-1", "keyword-2"]
  }' \\
  "https://app.evercontent.io/api/projects/PROJECT_ID/posts"
\`\`\`

Publish a post:

\`\`\`bash
curl -s -X POST \\
  -H "x-api-key: $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{}' \\
  "https://app.evercontent.io/api/v1/posts/POST_ID/publish"
\`\`\`

## Scope rules
- If \`allowedProjectIds\` exists, never use a project outside that list.
- If \`allowedCustomerIds\` exists, never use a customer outside that list.
- If no allow-lists are configured, discovery is unrestricted.
- If a project action is requested without a \`projectId\`, use \`defaultProjectId\` if present.
- If a customer-scoped listing is requested without a \`customerId\`, use \`defaultCustomerId\` if present.
- Prefer project-scoped operations when a project ID is available.

## Safety
- Default to draft creation and review-safe behavior.
- Treat publish as privileged.
- If \`canPublish\` is not \`true\`, refuse publish and explain that publishing is disabled.
- Never print the API key in output.
- Keep output operational and concise: project, post, status, and next step.
`,
  metadata: {
    version: 1,
    category: "content",
    icon: "📝",
    reviewSafeByDefault: true,
    auth: {
      type: "header-api-key",
      header: "x-api-key",
      secretRefField: "secretRef",
    },
    openclaw: {
      requires: {
        bins: ["curl", "jq"],
        env: ["EVERCONTENT_API_KEY"],
      },
      primaryEnv: "EVERCONTENT_API_KEY",
    },
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        secretRef: {
          type: "object",
          title: "EverContent API key",
          description: "CrewCmd secret reference used to sync apiKey into the OpenClaw runtime config",
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
      required: ["secretRef"],
    },
    configExample: {
      secretRef: { name: "evercontent-api-key" },
      defaultScope: "project",
      allowedProjectIds: ["project_456"],
      canPublish: false,
    },
  },
};
