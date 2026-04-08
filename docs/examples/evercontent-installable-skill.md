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
- `defaultCustomerId`
- `defaultProjectId`
- `allowedCustomerIds`
- `defaultScope` (`v1`, `customer`, or `project`)

## What this first pass does

- makes EverContent installable/importable in CrewCmd
- makes the service contract visible in skill metadata
- supports per-agent scoped config
- keeps publish permissions opt-in

## Remaining runtime gap

This first pass packages the skill cleanly, but it does not yet add a generic service-skill executor that turns actions like `posts.create` into live EverContent API calls from CrewCmd runtime.

That follow-up should stay generic so future SaaS skills can reuse it.
