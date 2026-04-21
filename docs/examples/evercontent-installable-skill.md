# EverContent installable skill

CrewCmd can now install EverContent as a normal skill record and assign it to agents through the existing skills flow.

## Install

Open **Skills** and install **EverContent** from the browse list.

The installed skill record includes:
- human-readable skill instructions in `content`
- machine-readable service manifest in `metadata`
- a config schema for assignment-time settings
- publish disabled by default

## Assign to an agent

Attach the skill to an agent, then save config like:

```json
{
  "baseUrl": "https://app.evercontent.com",
  "secretRef": { "name": "evercontent-api-key" },
  "allowedProjectIds": ["project_456"],
  "canPublish": false
}
```

Optional fields:
- `defaultProjectId`
- `allowedProjectIds`
- `canPublish`

## Current workflow

- makes EverContent installable/importable in CrewCmd
- makes the service contract visible in skill metadata
- supports per-agent scoped config
- keeps publish permissions opt-in
- supports live service actions for:
  - `projects.list`
  - `posts.list`
  - `posts.get`
  - `posts.create`
  - `posts.update`
  - `posts.generate`
  - `posts.generateBulk`
  - `posts.shareLink`
  - `posts.publish`

## Review-safe flow

For review passes, the recommended agent flow is:

1. `posts.get`
2. `posts.update`
3. `posts.shareLink`

That gives the agent a stable draft edit path plus a preview URL it can hand back to a human reviewer.
