# Collaborative AI Channels Orchestration Plan

## Objective

Make CrewCmd the open-source, self-hostable collaborative AI environment where humans and agents work together in channels, direct conversations, tasks, inboxes, and voice sessions without weakening personal runtime privacy.

This updates the earlier workspace-first framing. The user-facing model should be **channel / chat first**. Workspaces and runtimes still exist, but primarily as scope, ownership, and enforcement primitives behind the scenes. “Situation” can remain an internal architecture shorthand for any scoped collaboration context, but it should not be the main UI word.

## Product Thesis

CrewCmd should combine:

- **Personal AI work** — private, direct, ChatGPT/Claude-style conversations with a user's own agents and runtime.
- **Collaborative channels** — shared chats where multiple humans and multiple agents coordinate around a team, project, function, or incident.
- **OpenClaw-native agent operations** — agents have callsigns, skills, runtime bindings, ownership, tasks, inboxes, budgets, and governance.

The differentiator is not “AI in chat.” It is **collaborative AI channels with explicit agent participation rules and hard runtime privacy boundaries**.

## Current Foundation

CrewCmd already has several primitives that support this direction:

- `workspaces` support `personal` and `company` types.
- Agents have ownership and visibility concepts: `ownerType`, owner IDs, and `private` / `team` / `org` visibility.
- OpenClaw runtime import already connects CrewCmd to self-hosted agent runtimes.
- Chat sessions, messages, thread sync, voice chat, inbox, task board, skills, and agent org chart are already present.
- Governance primitives exist for approvals, auditability, runtime configuration, and budget controls.

This plan sharpens those pieces into a channel-first collaboration model.

## Core Model

### 1. Channel / Chat First

Users should mostly feel like they are moving between **channels and chats**, not switching infrastructure workspaces.

A channel/chat may be:

- a private direct conversation with an agent;
- a direct human-to-human conversation with optional agent help;
- a team channel such as `#marketing`, `#engineering`, or `#support`;
- a project room;
- a task thread;
- a voice session with transcript and follow-up actions.

Each channel/chat carries metadata:

- participants: humans and agents;
- visibility: private, team, org, or restricted group;
- runtime scope: personal runtime, company runtime, or project runtime;
- permissions: who can read, post, invite, mention agents, assign tasks, approve work;
- memory/context policy: what context can be used and what must stay excluded;
- audit/provenance: who invoked an agent, what was shared, and where artifacts came from.

### 2. Channels as Collaborative Surfaces

Channels are shared chats for ongoing work. A marketing channel, for example, can include multiple humans and multiple agents.

A channel should support:

- human messages;
- agent mentions;
- agent-authored responses;
- task creation and assignment;
- inbox/escalation items;
- pinned context and files;
- voice sessions;
- project or campaign context;
- review/approval flows.

Example:

```text
#marketing
  humans: Roger, Alex, Priya
  agents: @copywriter, @designer, @analyst
  runtime scope: company marketing runtime
  agent mode: respond when mentioned; @analyst may post weekly proactive summaries
  visibility: marketing team
```

Agent interactions should feel natural:

- `@copywriter draft three launch hooks`
- `@designer turn this into ad variants`
- `@analyst summarize campaign performance`
- `@ops create follow-up tasks from this thread`

### 3. Agent Participation Modes

Agents must not all respond to every channel message. Each channel-agent membership should have a participation mode:

- **silent** — agent is available for tasks but does not read ongoing messages.
- **watching** — agent may read channel context but does not speak unless invoked.
- **respond when mentioned** — default for most shared channels.
- **proactive within guardrails** — agent may initiate updates under configured rules.
- **owner / on-call** — agent is responsible for a channel function and may triage, summarize, or escalate.

This keeps channels useful without becoming noisy or uncanny.

### 4. Personal Runtime Privacy Boundary

This is a hard invariant:

> A user's personal OpenClaw runtime is never attachable to a shared channel, shared workspace, company agent, or team-visible task.

Rules:

- Personal runtimes are private to the owning user.
- Personal agents can only use the owner's personal runtime in private chats.
- Shared/team channels can only invoke team, org, or project agents backed by approved shared runtimes.
- Personal memory, private prompts, private files, and private runtime context are never injected into shared agent prompts.
- Users may explicitly share an output, summary, artifact, or task derived from personal work, but not the underlying personal runtime or hidden context.
- Sharing must create provenance: who shared it, from which private chat, into which shared channel, and when.

This must be enforced in backend authorization and runtime routing, not only in UI copy.

### 5. Workspaces as Scope Infrastructure

Workspaces still matter, but they should not be the primary day-to-day metaphor.

Use workspaces for:

- tenancy and ownership;
- billing and membership;
- runtime binding policies;
- default permissions;
- data partitioning;
- governance and audit boundaries.

Use channels/conversations for:

- what users open;
- where humans and agents talk;
- where tasks and decisions emerge;
- where voice sessions happen;
- where project/team context accumulates.

Practical hierarchy:

```text
Account / Company
  ├─ Scope policies / workspaces
  │   ├─ personal scope for each user
  │   └─ shared company/project scopes
  ├─ Channels / chats
  │   ├─ private direct conversations
  │   ├─ team channels
  │   ├─ project rooms
  │   ├─ task threads
  │   └─ voice sessions
  ├─ Agents
  │   ├─ personal agents
  │   ├─ team agents
  │   └─ org agents
  ├─ Scope-aware resource pages
  │   ├─ Tasks
  │   ├─ Inbox
  │   ├─ Projects
  │   ├─ Automations
  │   ├─ Team / agents
  │   ├─ Skills
  │   └─ Blueprints
  └─ Runtime bindings
```

### 6. Scope-Aware Resource Pages

Moving away from workspace-first navigation means the rest of the app cannot stay as “workspace pages” either. Tasks, inbox, projects, automations, team, skills, and blueprints should become **permission-filtered global lenses over scoped resources**.

Every major resource should carry scope metadata:

- `private:user` — visible only to the owning user; default for personal-runtime and personal-agent output.
- `channel:<id>` — visible to members of a shared channel/chat.
- `project:<id>` — visible to project members and linked channel participants where configured.
- `team:<id>` — visible to a team/function.
- `org:<id>` — visible according to organization-wide policy.

Page behavior:

- **Task board** — shows all tasks the viewer can see, with filters for mine, private, channel, project, team, org, agent, and status. Personal-agent-created tasks default private.
- **Inbox** — shows all pending decisions, mentions, approvals, escalations, and agent updates the viewer can see. Private agent inbox items stay private unless explicitly shared.
- **Projects** — project rooms are scoped work contexts with tasks, docs, agents, automations, and channels attached. Private projects may exist for personal planning.
- **Automations** — automations inherit the scope where they are created. Personal automations can use only the owner's personal runtime; shared automations can use only approved shared runtimes.
- **Team / agents** — personal agents remain visible only to their owner; team/org agents are visible according to membership and policy. A personal agent should not become a shared channel participant by accident.
- **Skills** — skills should distinguish private/personal installs from team/org-approved skills. Shared agents can only use skills permitted by their shared runtime and scope.
- **Blueprints** — blueprints can be private drafts, team templates, or org-approved templates. Publishing a blueprint from private to shared scope must be explicit and auditable.

Promotion rules apply to every resource type, not just chat messages:

- Private resource → shared resource requires an explicit action.
- Promotion shares selected fields/artifacts/summaries, not hidden private context.
- Promotion records provenance: source chat/channel, actor, destination scope, timestamp, and copied fields.
- Team/global pages must never query raw “all resources”; they must query “all resources visible to this viewer.”

### 7. Runtime Binding

Runtime binding should answer: **which agent runtime is allowed to act in this channel/chat?**

- Private personal chats may use the user's personal OpenClaw runtime.
- Shared channels may use only approved shared/company/project runtimes.
- Agent records should make runtime source, owner, and visibility obvious.
- Channel-agent membership should validate that the agent's runtime is allowed for that channel scope.
- Moving work across scopes should copy/share artifacts, not runtime access.

Users should not need to think in raw runtime IDs, but they should always understand whether an agent is personal, team, or org-owned.

## UX Principles

1. **Channels are work surfaces, not just message streams.** They include people, agents, tasks, voice, memory, permissions, and runtime scope.
2. **Conversations remain durable.** Important work should be linkable, searchable, threadable, and convertible into tasks or artifacts.
3. **Agents are invited participants.** They should have roles and participation modes rather than behaving like global bots.
4. **Privacy is visible.** Every channel/chat should show whether it is private, team-visible, or org-visible.
5. **Sharing is intentional.** Private work moves into shared channels only through explicit user action.
6. **Runtime boundaries are backend-enforced.** UI affordances are not enough.
7. **Voice follows the same scope rules.** A private voice session stays private; a channel voice session is team-visible according to channel policy.

## Implementation Lanes

This plan now depends on the detailed [RBAC and permissions model](./rbac-permissions-model.md). Treat that model as part of the same change, not a follow-up: database shape, app-layer policy, RLS where available, API authorization, admin flows, frontend affordances, tests, and docs all need to move together.

### Lane 1 — Product Language and Information Architecture

- Update README and docs to describe CrewCmd as channel/chat-first collaborative AI.
- Keep workspaces in architecture language, but stop making workspace switching the main product metaphor.
- Define canonical terms: channel, chat, direct message, thread, project room, personal runtime, shared runtime, personal agent, team agent, org agent. Keep “situation” internal-only if used at all.

### Lane 2 — Data Model and RBAC Audit

Audit existing workspace, chat session, thread, runtime, agent visibility, company member, workspace grant, and agent access grant tables.

Questions to answer:

- Can `chat_sessions` become the durable channel/chat primitive?
- Do we need a first-class `channels` table, or can channels be typed/grouped conversations initially?
- Where should channel-agent membership and participation mode live?
- What fields are needed for visibility, participants, runtime scope, resource scope, provenance, RBAC grants, and promotion/sharing?
- Which checks prevent personal runtime use from shared contexts?
- Which company, channel, project, agent, and runtime roles are authoritative for each action?
- Which policies must be mirrored as Postgres RLS and which must be enforced in the TypeScript policy engine for PGlite/self-hosted modes?

Prefer additive migrations over rewrites.

### Lane 3 — Channel Membership, RBAC, and Agent Participation

- Add or document channel/conversation membership for humans and agents.
- Define channel roles: owner, admin, member, contributor, viewer, guest.
- Define agent capabilities: view, invoke, configure, manage membership, view logs, manage budget, retire.
- Define runtime capabilities: view, configure, bind, invoke, rotate/remove credentials.
- Add agent participation modes.
- Default shared-channel agents to `respond when mentioned` unless configured otherwise.
- Add backend checks that reject agents/runtimes not allowed in the channel scope.

### Lane 4 — Chat and Channel UX

- Show private/team/org scope clearly in the chat UI.
- Add channel-like collaborative surfaces for teams and projects.
- Make agent mentions and task handoff natural.
- Show which agents are present, watching, on-call, or mention-only.
- Avoid noisy multi-agent pile-ons.

### Lane 5 — Scope-Aware Resource Pages

- Update Tasks, Inbox, Projects, Automations, Team/agents, Skills, and Blueprints to behave as permission-filtered lenses over scoped resources.
- Add backend visible-to-viewer query helpers before changing page filters; frontend filtering must never be the security boundary.
- Add visible filters for mine, private, channel, project, team, org, and agent where relevant.
- Ensure personal-agent-created resources default to private owner scope.
- Ensure shared/channel/project/org resources are only visible to allowed members.

### Lane 6 — Personal-to-Shared Promotion Flow

- Add explicit “share to channel” / “create shared task” actions from private chats.
- Share only selected outputs/artifacts/summaries.
- Record provenance and audit events.
- Never expose hidden personal runtime context.

### Lane 7 — Runtime Visibility and Enforcement

- Show runtime ownership and scope in agent detail/settings views.
- Split personal runtime administration from company runtime administration in UI and API.
- Enforce runtime routing server-side.
- Add tests for forbidden personal-runtime access from shared channels/chats.
- Add audit logs for shared runtime invocation, config changes, and promotion events.

### Lane 8 — Voice Collaboration

- Treat voice sessions as scoped chats/channels.
- Private voice transcripts stay private by default.
- Channel voice transcripts and action items become visible according to channel policy.
- Add post-call controls for sharing summaries, tasks, and decisions.

## PR Strategy

Keep the change reviewable with small PRs, but do not treat the later lanes as optional. Each implementation PR should include schema/API/frontend/tests/docs for its slice:

1. **Messaging PR** — README positioning and this orchestration plan.
2. **Architecture/RBAC audit PR** — document current schema/routes and additive gaps for channel/chat scope, roles, permissions, RLS/app-policy enforcement, admin flows, and tests.
3. **Policy engine PR** — add canonical permission helpers, role matrices, fixtures, and unit tests before relying on UI checks.
4. **Channel membership PR** — introduce or formalize channel/conversation membership, channel roles, and agent participation mode.
5. **Runtime guard PR** — enforce that personal runtimes cannot be used in shared contexts, with API and policy tests.
6. **Channel UX PR** — expose participants, agent modes, scope labels, disabled-control reasons, and channel admin flows in chat.
7. **Scoped resources PR** — make Tasks, Inbox, Projects, Automations, Team, Skills, and Blueprints permission-filtered lenses over scoped resources.
8. **Promotion flow PR** — allow selected private outputs and resources to be shared intentionally with provenance and audit trail.
9. **Voice scope PR** — align voice sessions/transcripts with channel/chat scope.
10. **RLS hardening PR** — mirror policy-engine rules as hosted Postgres RLS where supported and keep PGlite/self-hosted policy tests authoritative.

## Open Questions

- Should channels be first-class tables immediately, or typed conversations first?
- Should “situation” be removed entirely, or kept only as an internal architecture shorthand?
- How should users discover available team agents inside a channel?
- Should a personal agent ever be mentionable in a shared channel if only the owner sees/uses it, or is that too confusing?
- How should channel memory be summarized, retained, and pruned?
- Can a project room and a channel be the same primitive with different labels?
- Which resource types need separate share/promotion copies versus visibility changes in place?
- Which permissions are company-level, channel-level, project-level, agent-level, and runtime-level?
- Should company admins have emergency access to channel content, or only metadata/audit recovery by default?

## Non-goals for the First PRs

- No provider calls in tests.
- No automatic external publishing.
- No migration that breaks existing local PGlite installs.
- No merge of docs or implementation PRs without human review.
- No weakening of personal runtime privacy.
- No shared-channel access to a user's personal OpenClaw runtime.
