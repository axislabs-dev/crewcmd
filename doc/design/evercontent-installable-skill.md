# Design: EverContent as an Installable CrewCMD Skill

## Goal

Ship EverContent as a **custom installable skill** that can be assigned to one or more agents, without baking EverContent-specific logic into CrewCMD OSS core.

This should also establish the reusable pattern for future SaaS skills like ClutchCut.

## What exists today

CrewCMD already has the right first-pass primitives:

- `skills` table for installed skills
- `agent_skills` join table for per-agent assignment + config
- built-in execution skills (`claude-code`, `codex`, `github`, etc.)
- custom/imported skills with `content` and `metadata`
- agent skill attach/remove APIs
- a documented direction toward `provider + skills` instead of adapter-only agents

Relevant files:

- `src/db/schema.ts`
- `src/app/api/skills/route.ts`
- `src/app/api/skills/import/route.ts`
- `src/app/api/agents/[callsign]/skills/route.ts`
- `src/lib/skills/built-in.ts`
- `doc/design/provider-skills-architecture.md`
- `docs/concepts/skills.md`

## Recommendation

Implement EverContent as a **custom skill package + assignment config**, not as a new hardcoded CrewCMD provider or core feature.

### Pattern

1. **Skill record**
   - `skills.source = "custom"` (or later `marketplace`/`private-registry`)
   - `skills.content` contains the skill instructions / contract
   - `skills.metadata` defines the machine-readable manifest

2. **Per-agent assignment config**
   - store EverContent connection + scope in `agent_skills.config`
   - lets different agents use the same skill against different accounts, clients, or permission scopes

3. **Runtime delivery**
   - when an agent session is prepared, CrewCMD should inject:
     - the skill instruction content
     - the resolved assignment config
     - optionally any secrets by reference, not raw in markdown

4. **Core remains generic**
   - CrewCMD only knows how to install, assign, configure, enable/disable, and inject skills
   - EverContent-specific endpoints, auth rules, and workflows stay inside the skill contract

## Minimal v1 skill model

Use existing tables; do **not** add new tables in v1 unless required.

### `skills.metadata` for EverContent

```json
{
  "kind": "service-skill",
  "service": "evercontent",
  "version": 1,
  "auth": {
    "type": "bearer"
  },
  "capabilities": [
    "clients:list",
    "projects:list",
    "posts:list",
    "posts:get",
    "posts:create",
    "posts:update",
    "posts:submit"
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "baseUrl": { "type": "string" },
      "workspaceId": { "type": "string" },
      "defaultClientId": { "type": "string" },
      "defaultProjectId": { "type": "string" },
      "allowedClientIds": { "type": "array", "items": { "type": "string" } },
      "allowedProjectIds": { "type": "array", "items": { "type": "string" } },
      "canPublish": { "type": "boolean" }
    }
  }
}
```

### `agent_skills.config` for EverContent

```json
{
  "baseUrl": "https://app.evercontent.com",
  "workspaceId": "ws_123",
  "defaultClientId": "client_123",
  "defaultProjectId": "project_456",
  "allowedClientIds": ["client_123"],
  "allowedProjectIds": ["project_456"],
  "canPublish": false,
  "secretRef": "company:evercontent:primary"
}
```

Notes:
- `secretRef` is the important pattern to reuse later for other SaaS skills.
- Avoid storing raw API keys in `skills.content` or `agent_skills.config`.
- In v1, if CrewCMD lacks a generic secrets abstraction for non-LLM services, add one **generically** later rather than making an EverContent-only column.
- The default operating mode should be **review-only**: agents can discover, draft, and submit content for review, but should not publish directly unless a broader permission is explicitly granted in assignment config.

## Minimal v1 API / skill surface

Treat this as the contract exposed to the agent through the skill instructions.

### Discovery

#### `clients.list`
List clients visible to the configured EverContent account.

Suggested response:

```json
{
  "items": [
    { "id": "client_123", "name": "Acme" }
  ]
}
```

#### `projects.list`
List projects, optionally filtered by client.

Input:

```json
{
  "clientId": "client_123"
}
```

Response:

```json
{
  "items": [
    {
      "id": "project_456",
      "clientId": "client_123",
      "name": "Acme Blog"
    }
  ]
}
```

### Blog post operations

#### `posts.list`
List blog posts for a project.

Input:

```json
{
  "projectId": "project_456",
  "status": "draft",
  "limit": 20,
  "cursor": null
}
```

#### `posts.get`
Fetch one post with full editable fields.

Input:

```json
{ "postId": "post_789" }
```

#### `posts.create`
Create a draft post.

Input:

```json
{
  "projectId": "project_456",
  "title": "How to ...",
  "brief": "Short brief",
  "contentMarkdown": "# Draft",
  "keywords": ["crewcmd"],
  "status": "draft"
}
```

#### `posts.update`
Update mutable draft fields.

Input:

```json
{
  "postId": "post_789",
  "title": "Updated title",
  "brief": "Updated brief",
  "contentMarkdown": "# Updated",
  "keywords": ["crewcmd", "automation"]
}
```

#### `posts.submit`
Submit draft for review / handoff / publish pipeline.

Input:

```json
{
  "postId": "post_789"
}
```

Response:

```json
{
  "id": "post_789",
  "status": "in_review"
}
```

## Why this is the right v1 surface

It keeps the API small and useful:

- enough discovery to pick the right client/project
- enough CRUD to create and edit drafts
- one lifecycle transition (`submit`) instead of over-modeling publish states

Do **not** add categories/tags/media/SEO scoring/calendar workflows until real usage demands them.

## What belongs in CrewCMD core

Generic only:

1. skill install/import CRUD
2. agent ↔ skill assignment CRUD
3. enable/disable per assignment
4. `metadata.configSchema` rendering in UI
5. generic `secretRef` resolution / secret injection for service skills
6. runtime skill injection (instructions + resolved config)
7. generic action execution pattern for service skills
8. audit trail around skill use / mutation

## What should stay in the EverContent skill

EverContent-specific only:

1. API base URL conventions
2. EverContent auth details
3. client/project/post entity mapping
4. post status semantics
5. request/response normalization
6. guardrails like "draft only" or "submit but do not publish"
7. domain instructions for content operations

## Clean implementation approach

### v1A: zero-core-change path

If Roger wants the fastest first pass:

- create EverContent as a custom skill record
- store a structured manifest in `skills.metadata`
- store scoped config in `agent_skills.config`
- inject the skill instructions into assigned agents
- use the existing CrewCMD custom skill path

This gives an installable/assignable skill immediately.

### v1B: one small generic core improvement

Add a **generic service-skill execution contract** to CrewCMD core:

```ts
interface ServiceSkillInvocation {
  skillSlug: string;
  action: string;
  input?: Record<string, unknown>;
}
```

And a generic dispatcher shape:

```ts
interface ServiceSkillHandler {
  validateConfig(config: unknown): void;
  invoke(action: string, input: unknown, context: SkillContext): Promise<unknown>;
}
```

Then EverContent is just one handler implementation registered outside OSS core or loaded from a private package.

This is the reusable pattern I’d recommend for ClutchCut and future SaaS skills.

## Recommended boundary for OSS core vs private extension

### OSS core
- skill registry/data model
- assignment/config plumbing
- secrets-by-reference plumbing
- UI for config schema
- generic invocation contract

### Private EverContent extension
- EverContent handler
- EverContent auth adapter
- EverContent request models
- EverContent-specific tests/fixtures
- EverContent-specific docs/examples

## Practical v1 rollout

1. Create custom skill: `evercontent`
2. Put human-readable operating instructions in `skills.content`
3. Put machine-readable manifest in `skills.metadata`
4. Store per-agent scope in `agent_skills.config`
5. Add one generic execution hook for service skills if needed
6. Keep publish permission off by default (`canPublish: false`)

## Suggested future generic follow-up

If this lands well, the next generic abstraction should be:

- `service-skill` manifest type
- generic secrets store for non-LLM integrations
- generic action executor for SaaS skills
- shared config-schema UI

That reusable substrate is the part worth putting into CrewCMD core.

EverContent itself is not.
