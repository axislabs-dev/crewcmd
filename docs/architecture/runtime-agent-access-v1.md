# Runtime + Agent Access Model v1

## Goal
Ship the minimum coherent control-plane slice for CrewCmd so the platform can distinguish personal vs org-owned runtimes, keep personal agents private by default, and only surface agents a viewer can actually access.

## Decisions

### 1) Ownership is explicit
Both runtimes and agents now carry:
- `ownerType`: `user | company`
- `ownerUserId`
- `ownerCompanyId`

This lets us model:
- developer bring-your-own runtime + agent (`ownerType=user`)
- org runtime hosting multiple org-owned agents (`ownerType=company`)

### 2) Visibility is explicit and policy-driven
Agents carry `visibility: private | team | org`.

Interpretation in v1:
- `private`: creator-only for personal agents; org-private for org-owned agents, with org admins still able to manage them
- `team`: visible to org contributors (`owner/admin/member`)
- `org`: visible to all org members including viewers

### 3) Safe default: personal agents stay private
Personal agents are forced to `private` on create/update.

We are **not** shipping ad-hoc personal sharing in v1. Existing per-user grant endpoints are intentionally disabled because they need approval workflow / admin mediation to be safe.

### 4) Runtime ownership drives agent ownership by default
When an agent is created on a runtime, the runtime ownership becomes the agent ownership.
If no runtime is selected:
- default owner is the current user
- org ownership is allowed only for company admins

### 5) Read filtering is server-side
`GET /api/agents` now filters at the API layer so chat and pickers only see accessible agents.

## Why this boundary
This delivers the model the product needs without inventing a full enterprise ACL system:
- schema is clear
- APIs enforce sane defaults
- UI explains ownership + visibility
- risky personal sharing is deferred, not half-shipped

## Deliberately deferred
- approval workflow for sharing personal agents
- explicit team entities / team-scoped ACLs
- per-user grants as a supported UX
- cross-org sharing
- runtime-level policy inheritance beyond ownership
- fine-grained action permissions beyond basic read/manage
