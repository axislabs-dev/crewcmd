# Hybrid AI Workspace Orchestration Plan

## Objective

Make CrewCmd the open-source, self-hostable workspace where private personal AI conversations and shared team collaboration coexist without blurring boundaries. The product should feel native to AI agents rather than like a Slack bot, while still preserving the team coordination patterns people expect from collaborative workspaces.

## Product Thesis

CrewCmd should become the hybrid of:

- **ChatGPT / Claude-style personal AI work** — fast, private, direct conversations with agents, backed by one user's runtime and context.
- **Slack-style team coordination** — shared spaces where humans and agents can see the same work, hand off tasks, escalate blockers, and keep durable history.
- **OpenClaw-native agent operations** — agents are not anonymous assistants inside a chat box; they have callsigns, skills, runtime bindings, budgets, tasks, inboxes, and governance.

The differentiator is not “AI in chat.” It is **collaborative AI workspaces with explicit privacy and runtime boundaries**.

## Current Foundation

CrewCmd already has several primitives that support this direction:

- `workspaces` support `personal` and `company` types.
- Agents have ownership and visibility concepts: `ownerType`, owner IDs, and `private` / `team` / `org` visibility.
- OpenClaw runtime import already connects CrewCmd to self-hosted agent runtimes.
- Chat sessions, messages, thread sync, voice chat, inbox, task board, skills, and agent org chart are already present.
- Governance primitives exist for approvals, auditability, runtime configuration, and budget controls.

This plan sharpens those pieces into one coherent product model.

## Target Model

### 1. Personal Workspace

A personal workspace is the user's private AI operating area.

It should contain:

- private conversations with one or more agents;
- personal agents imported from or backed by the user's OpenClaw runtime;
- private tasks, drafts, notes, and inbox items;
- private voice sessions;
- runtime and model preferences scoped to that user.

Default rule: **nothing from a personal workspace becomes team-visible unless the user explicitly promotes or shares it**.

### 2. Shared Team Workspace

A shared workspace is where a company or project coordinates humans and agents together.

It should contain:

- shared conversations and channels;
- team-owned or company-owned agents;
- team-visible tasks, approvals, inbox items, projects, and goals;
- shared runtime bindings for company agents;
- audit trails for decisions, escalations, and approvals.

Default rule: **shared workspace context is visible according to company membership, workspace role, agent visibility, and governance settings**.

### 3. Conversations as the Durable Primitive

Conversations should be the base collaboration object. A conversation can start private, direct, threaded, project-scoped, or team-visible.

Channels can come later as containers or routing views over conversations, but they should not be the only primitive. This keeps CrewCmd closer to native AI interaction than Slack's channel-first mental model.

A practical hierarchy:

```text
Workspace
  ├─ Conversations
  │   ├─ direct human ↔ agent
  │   ├─ multi-agent room
  │   ├─ human team + agent room
  │   └─ thread / subtask conversation
  ├─ Optional channels / rooms
  ├─ Tasks
  ├─ Inbox
  ├─ Agents
  ├─ Skills
  └─ Runtime bindings
```

### 4. Runtime Binding

CrewCmd should expose runtime boundaries clearly:

- A personal workspace can bind to a user's private OpenClaw runtime.
- A shared workspace can bind to one or more company-managed OpenClaw runtimes.
- An agent record should make its runtime source, ownership, and visibility obvious.
- Moving work across boundaries should preserve provenance: who shared it, from where, and which runtime/agent produced it.

Users should not need to understand every OpenClaw detail, but they should always understand whether an agent is private, shared with a team, or organization-wide.

## UX Principles

1. **Do not copy Slack blindly.** Slack is good for team visibility, but AI work often starts as personal thinking, drafting, and iteration.
2. **Do not copy ChatGPT blindly.** Personal AI chat is powerful, but teams need shared context, accountability, tasks, and approvals.
3. **Make privacy visible.** Every conversation, agent, task, and inbox item should make its scope obvious.
4. **Make promotion intentional.** Sharing private work into a team space should be a clear action, not an accidental side effect.
5. **Keep agents legible.** Agents should have callsigns, roles, skills, runtime status, ownership, and escalation paths.
6. **Voice is first-class.** Voice chat should work in personal mode and collaborative mode, with transcript and sharing rules that match the workspace scope.

## Implementation Lanes

### Lane 1 — Product Language and Information Architecture

- Update README and docs to describe CrewCmd as a hybrid personal/private + collaborative AI workspace.
- Name the core scopes consistently: personal workspace, shared workspace, conversation, channel/room, agent, runtime.
- Add onboarding copy that explains the private-to-shared boundary.

### Lane 2 — Data Model Audit

- Audit existing workspace, chat session, thread, runtime, and agent visibility tables.
- Confirm whether `chat_sessions` can represent personal, shared, direct, team, and thread conversations without schema churn.
- Identify any missing fields for conversation visibility, participants, promotion provenance, and runtime provenance.
- Prefer additive migrations over rewrites.

### Lane 3 — Conversation UX

- Make the chat UI clearly show whether the current conversation is private or shared.
- Add affordances for starting:
  - private agent conversation;
  - shared team conversation;
  - project/task-scoped conversation;
  - multi-agent conversation.
- Add a later “promote/share to workspace” flow for private work.

### Lane 4 — Workspace and Runtime UX

- Show personal and shared workspaces as separate top-level scopes.
- Make runtime bindings visible in settings and agent detail views.
- Distinguish personal agents, team agents, and org agents in lists, cards, and access controls.

### Lane 5 — Governance and Audit

- Add audit events when private work is promoted into shared context.
- Require approval gates for sensitive runtime/config changes.
- Preserve traceability for agent-generated work: source conversation, source agent, runtime, user action, and destination workspace.

### Lane 6 — Voice Collaboration

- Treat voice sessions as conversations with the same privacy model.
- In personal mode, transcripts stay private by default.
- In shared mode, transcripts and action items become team-visible according to workspace permissions.
- Add clear post-call controls for publishing summaries, tasks, and decisions.

## PR Strategy

Keep the change reviewable with small PRs:

1. **Messaging PR** — README positioning and this orchestration plan only.
2. **Architecture audit PR** — document current schema/routes and identify additive model gaps.
3. **Conversation scope PR** — add explicit scope labels and copy in the chat UI.
4. **Workspace switcher PR** — clarify personal vs shared workspace navigation.
5. **Runtime visibility PR** — expose runtime binding and ownership more clearly.
6. **Promotion flow PR** — allow private conversation artifacts to be shared intentionally.
7. **Voice scope PR** — align voice session transcripts and summaries with conversation scope.

## Open Questions

- Should channels be first-class tables, or views/groupings over conversations?
- Should a conversation always belong to exactly one workspace, or can it be promoted/forked across workspaces?
- How should private personal agents participate in shared conversations without leaking private memory/context?
- Should company workspaces support multiple runtime bindings from day one?
- What is the simplest UX for “share this with the team” that still feels safe?

## Non-goals for the First PRs

- No provider calls in tests.
- No automatic social publishing or external posting.
- No migration that breaks existing local PGlite installs.
- No merge of docs or implementation PRs without human review.
- No weakening of personal runtime privacy.
