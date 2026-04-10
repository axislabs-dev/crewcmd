# Skill Config + Secrets UX v1

> Status: shipped v1 slice
> Date: 2026-04-10

## Why this slice exists

CrewCmd already supports:
- company-scoped vault entries in `service_secrets`
- `secretRef` values in `agent_skills.config`
- runtime-time resolution of those references for service skills and OpenClaw sync

But the primary UX was still a raw JSON textarea in the agent skill assignment panel. That was too easy to misuse, too easy to paste raw API keys into, and too hard to dogfood safely.

This slice changes the default path:
- render a normal form first when a skill exposes a basic `metadata.configSchema`
- keep raw JSON available as an advanced fallback
- make API-key style config fields use a first-class secret picker / create flow
- continue storing secret references instead of raw credential values

## Scope model

### Secret scope

Two scopes exist in the target model:
- **private** — owned by one user for their own personal agents
- **org** — owned by the company/org and usable by shared org agents

### Owner model

A secret owner is one of:
- **user**
- **company**

### Access rule

- **personal agents** can use **private** secrets and org secrets they are allowed to access
- **shared/org agents** can only use **org** secrets

### Runtime rule

Skill config stores **references**, not raw credential values. The runtime resolves the underlying secret value **only at execution time**.

That keeps raw secrets out of chat history, agent skill config payloads, and ordinary UI reads.

## What v1 actually ships

This repo already has a company-scoped secret vault. So v1 intentionally ships the narrowest reviewable product slice on top of that existing system:

- company/org secret picker in the agent skill config panel
- inline create-secret flow from the same panel
- typed field rendering for basic schema fields:
  - string
  - string enum
  - boolean
  - string arrays
  - `secretRef` object fields
- client-side validation before save
- advanced JSON fallback below the form
- no raw API key field in the primary path for supported skills

## What v1 does **not** change yet

This slice does **not** introduce a full new secret framework or DB migration for private/user-owned secrets.

Instead it documents the target model while reusing the existing company-scoped vault as the shipped org-secret mechanism.

Deferred:
- private/user-owned secrets storage and policy enforcement
- explicit agent visibility policies beyond current company scoping
- test-connection execution flow per provider/skill
- broader schema widget coverage beyond the common field types above
- migration tooling for older configs that stored freeform shapes

## Data shape

Supported credential values in config remain reference-only:

```json
{
  "secretRef": {
    "name": "evercontent-api-key"
  }
}
```

Example assignment config:

```json
{
  "baseUrl": "https://app.evercontent.com",
  "secretRef": { "name": "evercontent-api-key" },
  "allowedProjectIds": ["project_456"],
  "canPublish": false
}
```

Notes:
- the persisted value stays reference-only
- API responses for service secrets remain masked
- runtime resolution still happens in service skill execution and OpenClaw sync codepaths

## UX flow

1. User assigns a skill to an agent
2. CrewCmd inspects `skill.metadata.configSchema`
3. If the schema uses supported field types, CrewCmd renders a typed form
4. If a field is a `secretRef`, user can:
   - pick an existing org secret
   - create a new org secret inline
5. Save validates locally, then calls the existing agent-skill API
6. Server re-validates secret references before persist
7. Runtime resolves values later, only when the skill executes or sync materializes env vars

## Dogfood coverage

The typed form path is generic for supported schema types.

Today the repo includes first-class metadata for:
- EverContent

The same form path is designed to support Larry slideshow and RSCreative queue-post style skills once they expose compatible `configSchema` metadata. That follow-up should mostly be metadata work, not a second UI rewrite.

## Why no test connection yet

A meaningful test-connection flow needs per-skill runtime logic, side-effect boundaries, and response contracts. That is beyond this slice.

v1 leaves a clear place in the form UX for a future “Test connection” action, but ships without making fake or weak checks look real.
