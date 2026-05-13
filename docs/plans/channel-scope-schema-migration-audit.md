# Channel Scope Schema Migration Audit

Context: PR #452 defines the target AI-first Slack-class collaboration model: channels, channel membership, shared scope metadata, runtime scope bindings, resource grants, promotions, and conservative privacy boundaries. This audit maps the current database shape to a safe additive migration path.

## Recommendation

Start with a small **scope vocabulary and migration contract** PR before adding first-class `channels` / `channel_members` tables.

Do not introduce the channel tables as the first implementation slice. The current app already has workspace-scoped chat, tasks, inbox, skills, agents, and runtimes, but the policy semantics are not centralised yet. Adding channel rows before shared scope constants, backfill rules, and route policy helpers would make it too easy to broaden existing visibility accidentally.

Recommended first migration sequence:

1. Add shared TypeScript constants/types for scope values, resource kinds, member kinds, channel roles, agent participation modes, and conservative backfill states.
2. Add policy helper stubs/tests that default ambiguous or missing scope to restricted/private.
3. Add nullable scope/provenance columns to existing resource tables in narrow batches, with no route broadening.
4. Backfill only rows that have unambiguous owner/workspace/company evidence; leave ambiguous rows restricted/private.
5. Add first-class `channels` and `channel_members` after route reads can enforce membership.
6. Add `runtime_scope_bindings`, `resource_grants`, and `resource_promotions` after the policy engine can enforce them.

## Current schema map

| Current object | Current role | Target mapping | First safe move |
| --- | --- | --- | --- |
| `companies` / `company_members` | Company tenancy and coarse roles. | Keep as org governance baseline. Channel/project roles layer on top. | No migration needed for first scope pass. |
| `workspaces` / `agent_workspace_grants` | Legacy/backend personal or company scope plus agent workspace grants. | Preserve as tenancy/default-scope infrastructure, not user-facing Slack metaphor. | Keep identifiers and use only as conservative backfill evidence. |
| `agents` | Agent ownership (`ownerType`, `ownerUserId`, `ownerCompanyId`), visibility, runtime link. | Seed agent policy; channel participation belongs in `channel_members`. | Do not reinterpret `visibility` as channel access. |
| `company_runtimes` | Runtime ownership can be user/company; `companyId` is nullable after `0020`. | Runtime binding rules: personal runtimes private-only, shared runtimes shared-scope-only. | Add policy/types first; add `runtime_scope_bindings` later. |
| `chat_sessions` | Durable chat session, currently agent-centric with nullable `companyId` / `workspaceId`. | Candidate for private chats/DMs/channel backing, but not enough membership metadata yet. | Add nullable scope columns later; do not make channels by inference only. |
| `chat_threads` | Thread/session linkage with company/workspace uniqueness. | Thread resources inherit parent scope unless explicitly promoted/copied. | Add scope inheritance contract before migration. |
| `chat_messages` | Message content under a session. | Usually inherits session scope; message-level exceptions only for promotions/redactions. | Avoid broad message-level backfill in first pass. |
| `chat_message_pins` / `saved_items` | User affordances around chat/resources with workspace/company hints. | Scope-aware durable channel memory. | Backfill from source resource only when resolvable. |
| `tasks` | Task board items with project/workspace/company. | Scope-aware resources visible through private/project/channel/team/org membership. | Add nullable scope/provenance columns in a later batch. |
| `inbox_messages` | Agent-to-user/agent messages with workspace/company hints. | Scope-aware inbox items and approvals. | Ambiguous items remain addressed/private to explicit recipient. |
| `projects` | Project container with workspace/company. | Project scope and project rooms/channels. | Project scope can be introduced before channel linkage. |
| `skills` / `team_blueprints` | Workspace/company or company-scoped capability catalogs. | Scope-aware skills/blueprints with grants. | Add scope only after policy reads exist. |
| `approval_requests` / `audit_log` / `activity_log` | Governance and event history. | Must record promotions, binding changes, membership changes, and admin recovery. | Extend audit/event semantics with no hidden private context. |

## Migration constraints found

- Drizzle is configured for PostgreSQL and local PGlite through `drizzle.config.ts`; migrations must keep PGlite installs working.
- Existing migration history is linear through `0029_chat_pins_saved_items` in `drizzle/meta/_journal.json`.
- Recent migrations already used additive nullable columns and `IF NOT EXISTS`/duplicate guards for chat-related changes. Continue that style for compatibility.
- The current schema preserves important identifiers that downstream code likely imports: `chatSessions` / `chat_sessions`, `tasks`, `inboxMessages`, `companyRuntimes` / `company_runtimes`, runtime `workspaceAccess` call sites, `agentWorkspaceGrants`, and `agentAccessGrants`.
- `schema-access.ts` and `schema-inbox.ts` contain older migration/spec snippets; the canonical current schema is `src/db/schema.ts` plus numbered `drizzle/*.sql` migrations.

## Conservative backfill rules

These rules should be written into the first real migration PR and enforced by tests:

- Missing scope means restricted/private, never public/team/org.
- Conflicting evidence means restricted/private and requires explicit user/admin action.
- Personal/user-owned runtime rows must never be bound to shared channel, project, team, or org scopes.
- `ownerUserId` evidence may create a private user scope; it must not create shared membership.
- `workspaceId` may identify a legacy default scope but must not imply channel membership.
- `companyId` alone may identify tenancy/governance but must not imply every company member can read the row.
- `chat_messages`, pins, saved items, chat runs, and threads should inherit scope from their parent/source only when the parent/source is unambiguous.
- Promotions from private to shared scopes must create copied/derived destination artifacts plus `resource_promotions` and audit rows; do not mutate the source in place to broaden visibility.
- Rows that cannot be safely classified should remain readable only through existing explicit owner/recipient/admin paths until manually promoted or assigned.

## Proposed additive migration slices

### Slice 1: scope vocabulary and policy contract

- Add constants/types for `scopeType`, `resourceType`, `principalType`, `channelType`, `channelRole`, `agentParticipationMode`, and promotion metadata.
- Add tests for deny-by-default behavior around missing/ambiguous scope and runtime binding.
- No database migration and no runtime behavior change unless wired behind existing checks.

### Slice 2: nullable scope metadata batch

Add nullable columns to the lowest-risk existing resource group first, likely `tasks`, `projects`, `inbox_messages`, and `chat_sessions`:

- `scope_type`
- `scope_id`
- `owner_user_id`
- `created_from_scope_type`
- `created_from_scope_id`
- `shared_from_resource_type`
- `shared_from_resource_id`
- `shared_by_user_id`
- `shared_at`

Keep columns nullable initially. Add indexes on `(scope_type, scope_id)` and owner/company/workspace lookups only after query paths are known.

### Slice 3: channel primitives

Add first-class `channels` and `channel_members` only after membership-aware read helpers exist. This should be a separate PR from broad resource scope columns.

Important defaults:

- new channels default `visibility = 'restricted'` or equivalent non-public value;
- `channel_members` must support user and agent members;
- agents require explicit participation mode (`mention_only`, `watching`, `proactive`, `on_call`, etc.);
- no automatic company-wide membership from `companyId` alone.

### Slice 4: grants, runtime bindings, promotions

Add `resource_grants`, `runtime_scope_bindings`, and `resource_promotions` after policy helpers can be used in routes/background jobs.

Hard runtime rule: a runtime with `ownerType = 'user'` may only bind to a private user scope whose `scopeId`/owner matches that user.

## Risks

- Treating existing `workspaceId`/`companyId` as equivalent to channel membership would broaden visibility.
- Adding channel tables before route enforcement could create data that looks shared but is still protected only by older workspace/company checks.
- Backfilling chat sessions into shared scopes without explicit members could leak private agent conversations.
- PGlite compatibility may be harmed by complex migration SQL; keep migrations additive and simple, with tests or local migration smoke checks.

## First implementation PR checklist

- [ ] Constants/types only, or nullable columns only; do not combine with route behavior changes.
- [ ] Preserve existing exported schema identifiers.
- [ ] Include tests that missing/ambiguous scope is denied/restricted.
- [ ] Include tests that personal runtimes cannot bind to shared scopes.
- [ ] Include a backfill note for every table touched.
- [ ] Run `git diff --check`.
- [ ] Run `pnpm typecheck` or a narrower relevant test if TypeScript code changes.
