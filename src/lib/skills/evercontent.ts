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
  version: "0.4.0",
  sourceUrl: "https://evercontent.co",
  content: `# EverContent Skill

Use EverContent directly from OpenClaw via the external API-key surface to discover projects, inspect posts, create drafts, and publish only when explicitly enabled.

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
          "defaultProjectId": "project_456",
          "allowedProjectIds": ["project_456"],
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
- \`defaultProjectId\`: optional default project scope
- \`allowedProjectIds\`: optional allow-list of project IDs
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

Use the external API v1 contract for all requests:

\`\`\`bash
curl -s -H "Authorization: Bearer $EVERCONTENT_API_KEY" -H "content-type: application/json" ...
\`\`\`

## Supported operations
- \`projects.list\`
- \`posts.list\`
- \`posts.get\`
- \`posts.create\`
- \`posts.generate\`
- \`posts.generateBulk\`
- \`posts.publish\` (only when \`canPublish\` is \`true\`)

## When to use each operation
- Use \`posts.create\` when the user already has the article copy and wants to save a draft directly.
- Use \`posts.generate\` when the user gives a keyword, title idea, brief, transcript, or content direction and wants EverContent to generate the draft internally.
- Use \`posts.generateBulk\` when the user provides multiple keywords or article briefs and wants multiple generated drafts queued at once.
- Use \`posts.publish\` only when the user explicitly asks to publish and \`canPublish\` is \`true\`.

## API patterns
List projects:

\`\`\`bash
curl -s -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/v1/projects"
\`\`\`

List posts for a project:

\`\`\`bash
curl -s -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/v1/posts?projectId=PROJECT_ID"
\`\`\`

Get a post:

\`\`\`bash
curl -s -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  "https://app.evercontent.io/api/v1/posts/POST_ID"
\`\`\`

Create a draft post:

\`\`\`bash
curl -s -X POST \\
  -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "projectId": "PROJECT_ID",
    "title": "Draft title",
    "content": "# Draft content",
    "status": "draft"
  }' \\
  "https://app.evercontent.io/api/v1/posts"
\`\`\`

Generate a draft with EverContent's internal tools:

\`\`\`bash
curl -s -X POST \\
  -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "projectId": "PROJECT_ID",
    "primaryKeyword": "best payroll software for startups",
    "title": "Optional draft title",
    "targetAudience": "startup founders",
    "industry": "SaaS",
    "customInstructions": "Focus on practical buying criteria"
  }' \\
  "https://app.evercontent.io/api/v1/posts/generate"
\`\`\`

Bulk generate multiple drafts:

\`\`\`bash
curl -s -X POST \\
  -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "projectId": "PROJECT_ID",
    "jobs": [
      {
        "primaryKeyword": "best payroll software for startups",
        "targetAudience": "startup founders",
        "industry": "SaaS"
      },
      {
        "primaryKeyword": "startup payroll compliance checklist",
        "targetAudience": "operations leaders",
        "industry": "SaaS"
      }
    ]
  }' \\
  "https://app.evercontent.io/api/v1/posts/generate-bulk"
\`\`\`

Publish a post:

\`\`\`bash
curl -s -X POST \\
  -H "Authorization: Bearer $EVERCONTENT_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{}' \\
  "https://app.evercontent.io/api/v1/posts/POST_ID/publish"
\`\`\`

## Scope rules
- If \`allowedProjectIds\` exists, never use a project outside that list.
- If no project allow-list is configured, project discovery is unrestricted.
- If a project action is requested without a \`projectId\`, use \`defaultProjectId\` if present.
- Prefer project-scoped operations when a project ID is available.
- Bulk generation supports up to 10 jobs per request.

## Safety
- Default to draft creation and review-safe behavior.
- Prefer \`posts.generate\` or \`posts.generateBulk\` when the user wants EverContent to create the article body internally.
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
      header: "Authorization",
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
        defaultProjectId: { type: "string", title: "Default project ID" },
        allowedProjectIds: {
          type: "array",
          title: "Allowed project IDs",
          items: { type: "string" },
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
      allowedProjectIds: ["project_456"],
      canPublish: false,
    },
  },
};
