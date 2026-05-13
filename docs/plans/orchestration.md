# Collaborative AI Channels Orchestration Plan

## Objective

Make CrewCmd the open-source, self-hostable collaborative AI environment where humans and agents work together in channels, direct conversations, tasks, inboxes, and voice sessions without weakening personal runtime privacy.

This updates the earlier workspace-first framing. The user-facing model should be **channel / conversation / situation first**. Workspaces and runtimes still exist, but primarily as scope, ownership, and enforcement primitives behind the scenes.

## Product Thesis

CrewCmd should combine:

- **Personal AI work** — private, direct, ChatGPT/Claude-style conversations with a user's own agents and runtime.
- **Collaborative channels** — Slack-like shared situations where multiple humans and multiple agents coordinate around a team, project, function, or incident.
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

### 1. Situation / Conversation First

Users should mostly feel like they are moving between **situations**, not switching infrastructure workspaces.

A situation may be:

- a private direct conversation with an agent;
- a direct human-to-human conversation with optional agent help;
- a team channel such as `#marketing`, `#engineering`, or `#support`;
- a project room;
- a task thread;
- a voice session with transcript and follow-up actions.

Each situation carries metadata:

- participants: humans and agents;
- visibility: private, team, org, or restricted group;
- runtime scope: personal runtime, company runtime, or project runtime;
- permissions: who can read, post, invite, mention agents, assign tasks, approve work;
- memory/context policy: what context can be used and what must stay excluded;
- audit/provenance: who invoked an agent, what was shared, and where artifacts came from.

### 2. Channels as Collaborative Surfaces

Channels are shared situations for ongoing work. A marketing channel, for example, can include multiple humans and multiple agents.

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
- Personal agents can only use the owner's personal runtime in private situations.
- Shared/team channels can only invoke team, org, or project agents backed by approved shared runtimes.
- Personal memory, private prompts, private files, and private runtime context are never injected into shared agent prompts.
- Users may explicitly share an output, summary, artifact, or task derived from personal work, but not the underlying personal runtime or hidden context.
- Sharing must create provenance: who shared it, from which private situation, into which shared situation, and when.

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
  ├─ Channels / situations
  │   ├─ private direct conversations
  │   ├─ team channels
  │   ├─ project rooms
  │   ├─ task threads
  │   └─ voice sessions
  ├─ Agents
  │   ├─ personal agents
  │   ├─ team agents
  │   └─ org agents
  ├─ Tasks
  ├─ Inbox
  ├─ Skills
  └─ Runtime bindings
```

### 6. Runtime Binding

Runtime binding should answer: **which agent runtime is allowed to act in this situation?**

- Private personal situations may use the user's personal OpenClaw runtime.
- Shared channels may use only approved shared/company/project runtimes.
- Agent records should make runtime source, owner, and visibility obvious.
- Channel-agent membership should validate that the agent's runtime is allowed for that channel scope.
- Moving work across scopes should copy/share artifacts, not runtime access.

Users should not need to think in raw runtime IDs, but they should always understand whether an agent is personal, team, or org-owned.

## UX Principles

1. **Channels are situations, not just message streams.** They include people, agents, tasks, voice, memory, permissions, and runtime scope.
2. **Conversations remain durable.** Important work should be linkable, searchable, threadable, and convertible into tasks or artifacts.
3. **Agents are invited participants.** They should have roles and participation modes rather than behaving like global bots.
4. **Privacy is visible.** Every situation should show whether it is private, team-visible, or org-visible.
5. **Sharing is intentional.** Private work moves into shared channels only through explicit user action.
6. **Runtime boundaries are backend-enforced.** UI affordances are not enough.
7. **Voice follows the same scope rules.** A private voice session stays private; a channel voice session is team-visible according to channel policy.

## Implementation Lanes

### Lane 1 — Product Language and Information Architecture

- Update README and docs to describe CrewCmd as channel/situation-first collaborative AI.
- Keep workspaces in architecture language, but stop making workspace switching the main product metaphor.
- Define canonical terms: situation, conversation, channel, thread, personal runtime, shared runtime, personal agent, team agent, org agent.

### Lane 2 — Data Model Audit

Audit existing workspace, chat session, thread, runtime, and agent visibility tables.

Questions to answer:

- Can `chat_sessions` become the durable conversation/situation primitive?
- Do we need a first-class `channels` table, or can channels be typed/grouped conversations initially?
- Where should channel-agent membership and participation mode live?
- What fields are needed for visibility, participants, runtime scope, provenance, and promotion/sharing?
- Which checks prevent personal runtime use from shared contexts?

Prefer additive migrations over rewrites.

### Lane 3 — Channel Membership and Agent Participation

- Add or document channel/conversation membership for humans and agents.
- Add agent participation modes.
- Default shared-channel agents to `respond when mentioned` unless configured otherwise.
- Add backend checks that reject agents/runtimes not allowed in the channel scope.

### Lane 4 — Chat and Channel UX

- Show private/team/org scope clearly in the chat UI.
- Add channel-like collaborative surfaces for teams and projects.
- Make agent mentions and task handoff natural.
- Show which agents are present, watching, on-call, or mention-only.
- Avoid noisy multi-agent pile-ons.

### Lane 5 — Personal-to-Shared Promotion Flow

- Add explicit “share to channel” / “create shared task” actions from private situations.
- Share only selected outputs/artifacts/summaries.
- Record provenance and audit events.
- Never expose hidden personal runtime context.

### Lane 6 — Runtime Visibility and Enforcement

- Show runtime ownership and scope in agent detail/settings views.
- Enforce runtime routing server-side.
- Add tests for forbidden personal-runtime access from shared situations.
- Add audit logs for shared runtime invocation, config changes, and promotion events.

### Lane 7 — Voice Collaboration

- Treat voice sessions as scoped situations.
- Private voice transcripts stay private by default.
- Channel voice transcripts and action items become visible according to channel policy.
- Add post-call controls for sharing summaries, tasks, and decisions.

## PR Strategy

Keep the change reviewable with small PRs:

1. **Messaging PR** — README positioning and this orchestration plan.
2. **Architecture audit PR** — document current schema/routes and additive gaps for channel/situation scope.
3. **Channel membership PR** — introduce or formalize channel/conversation membership and agent participation mode.
4. **Runtime guard PR** — enforce that personal runtimes cannot be used in shared contexts.
5. **Channel UX PR** — expose participants, agent modes, and scope labels in chat.
6. **Promotion flow PR** — allow selected private outputs to be shared intentionally.
7. **Voice scope PR** — align voice sessions/transcripts with situation scope.

## Open Questions

- Should channels be first-class tables immediately, or typed conversations first?
- Is “situation” a product-facing word, or just an internal architecture concept?
- How should users discover available team agents inside a channel?
- Should a personal agent ever be mentionable in a shared channel if only the owner sees/uses it, or is that too confusing?
- How should channel memory be summarized, retained, and pruned?
- Can a project room and a channel be the same primitive with different labels?

## Non-goals for the First PRs

- No provider calls in tests.
- No automatic external publishing.
- No migration that breaks existing local PGlite installs.
- No merge of docs or implementation PRs without human review.
- No weakening of personal runtime privacy.
- No shared-channel access to a user's personal OpenClaw runtime.
