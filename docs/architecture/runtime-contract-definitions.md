# Runtime contract definitions

Status: draft product/implementation contract
Scope: CrewCmd personal runtimes, shared runtimes, channel agent modes, and workspace/company boundaries
Related: `docs/architecture/slack-channel-agent-runtime-ia.md`, `docs/runtime-routing-audit.md`, `docs/plans/channel-scope-schema-migration-audit.md`, `docs/plans/rbac-permissions-model.md`, `src/lib/collaboration-policy.ts`

## Purpose

CrewCmd supports a user working from a private cockpit while also participating in shared team channels. That only stays safe if the product contract separates four concepts that are easy to blur:

- **personal workspace**: the user's private operating surface;
- **organization/company**: the governance, membership, billing, and audit boundary;
- **channel/DM/project room**: the actual collaboration and visibility boundary;
- **runtime**: the execution home used by agents and automations.

This document defines the runtime side of that contract. It is intentionally narrower than the broader Slack-like channel IA: for the near-term product, **personal runtimes remain private** and shared collaboration uses **separately connected shared runtimes**.

## Definitions

### Personal workspace

A personal workspace is a private workspace owned by one user.

It may contain:

- private chats and drafts;
- personal agents;
- personal automations;
- private tasks, artifacts, and scratch work;
- the user's personal runtime registrations.

A personal workspace is not a team visibility boundary. Nothing in it becomes company-visible merely because the user also belongs to a company.

### Organization / company

A company is the shared governance boundary.

It owns or governs:

- members and roles;
- shared channels and project rooms;
- shared agents;
- shared runtime registrations;
- policy, audit, approvals, and billing.

Company membership alone does not mean every company member can read every company resource. Channels, DMs, project rooms, grants, and roles still decide visibility.

### Runtime

A runtime is execution capacity. It is where an agent or automation runs.

A runtime is not, by itself:

- a chat;
- a channel;
- a workspace;
- a visibility grant;
- permission for an agent to listen everywhere.

Runtime selection answers: **where does this execute?**

Conversation scope answers: **who can see and participate?**

Company/workspace ownership answers: **who governs and administers this?**

## Runtime classes

### Personal runtime

A personal runtime is owned by a user and attached to that user's personal workspace.

Hard rules:

- It can execute only for the owning user's private scopes.
- It can back personal agents and private human ↔ agent DMs for that owner.
- It cannot be attached to shared channels, shared project rooms, company agents, or team-visible tasks.
- It cannot be made available to other company members through implicit workspace or company membership.
- It cannot become a shared runtime through a hidden bridge or convenience fallback.

Near-term product decision: **personal runtimes stay private.** Promotion/bridging can be designed later, but should not be required for the current channel and voice work.

### Shared runtime

A shared runtime is owned or administered by a company.

Hard rules:

- It may execute only inside the company/shared scopes it is explicitly allowed to serve.
- It can back team/org agents.
- It can be used by shared channels and project rooms when channel policy allows agent participation.
- It must be managed by company owner/admin/operator roles, not by ordinary channel membership alone.
- Invocations and configuration changes should be auditable.

A shared runtime makes agents available to the organization. It does not make every agent active in every channel.

## Contract matrix

| Surface | Allowed runtime | Default behavior | Notes |
| --- | --- | --- | --- |
| Owner's private chat | Personal runtime | Allowed | Owner-only private scope. |
| Human ↔ personal agent DM | Personal runtime | Allowed | Only for the personal agent owner. |
| Human ↔ team agent DM | Shared runtime | Allowed if policy permits | Team agent must be visible to that user/team. |
| Shared `#crew` channel | Shared runtime | Mention-only/on-call, not proactive by default | Personal runtime must be rejected or hidden. |
| Shared project room | Shared runtime | Mention-only/on-call by project policy | Project membership still controls visibility. |
| Team-visible task automation | Shared runtime | Explicit binding required | Personal runtime cannot silently run team-visible work. |
| Private draft promoted to channel | Not a runtime binding | Explicit copy/share with audit | Share selected artifact/output, not hidden runtime context. |

## Agent participation modes

A shared runtime is execution capacity. Agent participation is configured per conversation.

Recommended channel/chat modes:

| Mode | Meaning | Suggested default |
| --- | --- | --- |
| `off` / `silent` | Agent cannot observe or respond in the conversation. | Human-only DMs, ordinary channels without agents. |
| `mention_only` | Agent responds only when explicitly mentioned or selected for a turn. | Default for most shared channels. |
| `watching` | Agent can observe for summaries or context but should not interject. | Project rooms where summaries are useful. |
| `on_call` | Agent may answer relevant messages without a direct mention. | Core team rooms after trust is established. |
| `proactive` | Agent may initiate or contribute actively. | Rare; requires clear channel expectation and audit. |

Default rule: **shared runtime available does not imply agent mode enabled.** Channel membership and channel-level agent mode decide whether an agent can see, listen, or act.

## Routing rules

### Private routing

When a user speaks or types in a private personal context:

1. resolve the private conversation/DM;
2. resolve the selected personal agent, if any;
3. require that the agent and runtime belong to the same user-private scope;
4. route to the agent's explicit `runtimeId` and `runtimeRef`;
5. reject ambiguous global-primary runtime fallbacks.

### Shared routing

When a user speaks or types in a shared channel/project room:

1. resolve the channel/room membership;
2. resolve the agent as a channel member or explicitly invokable team/org agent;
3. require a shared runtime owned by the same company/shared scope;
4. enforce the channel's agent participation mode;
5. route to the agent's explicit shared `runtimeId` and `runtimeRef`;
6. audit denied personal-runtime attempts and shared-runtime invocations where appropriate.

### Voice agent mode

Voice mode follows the same routing rules as text.

Voice-specific requirements:

- the UI should show who/what is listening: private agent DM, shared channel, or selected team agent;
- voice turns should land as normal chat messages in the resolved conversation;
- a shared channel should not start agent listening unless that channel's agent mode allows it;
- failures should say whether the issue is transcription, channel permission, agent membership, or runtime binding.

## Explicit non-goals for now

These are intentionally out of scope for the first shared-runtime testing path:

- personal runtime sharing;
- personal → shared runtime bridges;
- letting company admins inspect personal runtime hidden context;
- automatic promotion of private artifacts into shared rooms;
- global primary runtime fallback for chat/voice routing;
- agent mode enabled for every channel by default.

## Implementation implications

### Database / policy

Existing `company_runtimes.ownerType`, `ownerUserId`, and `ownerCompanyId` are enough to express the first version of this contract.

The policy layer should continue to make these checks explicit:

- personal runtime + private owner scope → allowed;
- personal runtime + shared scope → denied;
- shared runtime + shared matching company scope → allowed;
- shared runtime + private user scope → denied;
- mismatched owner/company → denied.

Future `runtime_scope_bindings` can make shared-runtime eligibility more precise, but the invariant should be enforced before that table exists.

### API

APIs that send chat, invoke agents, import runtimes, bind runtimes, or start voice/agent sessions should avoid process-wide runtime defaults.

Preferred API shape:

- use explicit `runtimeId` when managing a runtime;
- use explicit `agentId`/`agent.runtimeId` when invoking an agent;
- use explicit `channelId` or DM/channel session when sending a message;
- reject requests where the server cannot prove the conversation scope and runtime class match.

### UI

Normal chat should not ask the user to think about runtimes.

Recommended UI copy and affordances:

- personal runtime settings live under private account/personal workspace settings;
- shared runtime settings live under company admin/governance;
- channel details show agent membership and participation mode, not raw runtime plumbing;
- disabled controls explain the invariant, for example: “This is your personal runtime; it cannot be attached to shared channels.”

## End-to-end test setup

For current CrewCmd dogfooding, use two runtime registrations:

1. **Personal runtime**
   - owner type: `user`;
   - owner: Roger;
   - scope: Roger's personal workspace/private DMs;
   - expected behavior: works for private personal agent chat, hidden/blocked in shared channel binding.

2. **Shared runtime**
   - owner type: `company`;
   - owner: the test organization/company;
   - scope: `#crew`, shared channels, team/org agents;
   - expected behavior: powers shared channel agent mode when the channel permits it.

Smoke tests:

- private agent DM uses personal runtime;
- `#crew` mention to team agent uses shared runtime;
- personal runtime cannot be selected for `#crew`;
- shared runtime is not used for a private personal-agent DM;
- agent mode is off or mention-only by default in new shared channels;
- voice turns follow the same routing and permission decisions as text turns.

## One-line invariant

Personal runtimes are private execution homes; shared collaboration uses shared runtimes, and channel-level agent mode decides whether any shared agent can listen or respond.
