# RBAC Implementation Audit: Collaborative AI Workspace

Status: audit for PR strategy item 2 from `docs/plans/orchestration.md`.
Base audited: `origin/main` at `2f2295d` (`fix: guard api visibility by workspace scope (#462)`).

Post-audit update: the first implementation follow-ups have now landed on `main`: policy engine foundation (#463), channel membership schema foundation (#465), and shared chat runtime guard (#466). This document remains the audit trail for the original gap analysis; the remaining sections call out where those merged PRs have closed items.

## Executive summary

The current implementation has useful workspace/company seeds, but it is not yet a complete Slack-class channel/chat RBAC model.

Implemented today:

- `workspaces`, `company_members`, `company_runtimes`, `agents`, `agent_workspace_grants`, and `agent_access_grants` exist.
- `channels` and `channel_members` now exist with channel/member uniqueness indexes, channel/thread indexes, and a database check ensuring each member row maps to exactly one user or agent principal.
- `chat_sessions`, `chat_threads`, `chat_messages`, `chat_message_pins`, `saved_items`, and many app resources carry `company_id` and/or `workspace_id`; `chat_sessions` and `chat_threads` now also carry `channel_id`.
- `src/lib/workspace.ts` can resolve an accessible workspace from user session, cookies, explicit `workspaceId`, explicit `companyId`, or heartbeat bearer runtime scope.
- `src/lib/collaboration-policy.ts` now provides the first tested policy-engine foundation.
- `src/lib/channel-membership.ts` provides typed membership helpers and requires agent membership matching through the agent database UUID, not a callsign.
- `src/lib/runtime-scope-guard.ts` blocks personal primary runtime invocation in shared company/workspace chat contexts and records audit entries on rejections.
- `src/lib/agent-access.ts` and `src/lib/agent-route-auth.ts` provide route-specific authorization helpers that still need consolidation behind the canonical policy surface.

Still missing for the target architecture:

- No `resource_grants`, `runtime_scope_bindings`, or `resource_promotions` tables.
- The app-layer policy engine is seeded but not yet mandatory across every route for `actor -> scope -> resource -> action` decisions.
- No hosted Postgres RLS policy migrations. Current protection is route/helper based only.
- Several chat/pin/saved-item routes still rely on caller-supplied ids and do not consistently prove workspace/channel membership or agent readability before reading/mutating records.

## Implementation decisions resolved by this audit

1. **Use first-class `channels` immediately.**
   - Do not stretch `chat_sessions` into the durable product channel abstraction.
   - Keep `chat_sessions` as execution/history sessions under a channel, DM, project room, or private chat.
   - Rationale: current `chat_sessions` are agent/gateway-session centric (`agentId`, `gatewaySessionKey`, thread parent linkage). Adding channel membership, unread state, roles, topic/purpose, archive state, agent participation modes, and admin affordances directly to that table would mix execution state with collaboration identity.

2. **Model DMs as `channels(type = 'dm')` for v1.**
   - Human-human DMs, human-agent private chats, and small private group DMs should share the same `channels` + `channel_members` authorization path.
   - `channels.name` should be nullable for DMs; display names can be computed from members.
   - This avoids a second private-chat permission system.

3. **Defer external guests in v1.**
   - Current `company_members.role` is `owner | admin | member | viewer`; no `guest` role exists.
   - Guests require narrower membership semantics, invite expiry, external-domain controls, export controls, and channel-specific access. Add only after core member/viewer policy is stable.

4. **Make the TypeScript policy engine authoritative; hosted Postgres RLS is defense-in-depth.**
   - PGlite/self-hosted modes cannot depend on hosted RLS semantics.
   - Hosted RLS should mirror tested policy fixtures, not become an independent source of truth.
   - Route code should call one policy API before DB reads/mutations; RLS should catch mistakes in hosted Postgres.

5. **Do not allow personal runtimes in shared scopes.**
   - A runtime with `ownerType = 'user'` may only bind to `private:user` or explicit owner-only DMs where no other human can read the runtime output.
   - Shared channels/project/team/org scopes must use approved shared/company runtimes.

## Current schema inventory

### Existing scope and membership tables

- `workspaces`
  - Columns: `id`, `type` (`personal | company`), `name`, `ownerUserId`, `companyId`, timestamps.
  - Unique constraints for personal workspace and company workspace.
  - Gap: no generic `scopeType`/`scopeId`; only workspace-level scoping.

- `company_members`
  - Columns: `companyId`, `userId`, `role` (`owner | admin | member | viewer`), invite metadata.
  - Gap: no unique constraint was observed in `src/db/schema.ts` for `(companyId, userId)`, and no channel/project membership linkage.

- `agents`
  - Columns include `ownerType`, `ownerUserId`, `ownerCompanyId`, `visibility` (`private | team | org`), `runtimeId`, `runtimeRef`, `companyId`.
  - Gap: visibility is coarse and not tied to channel/project/team scope membership.

- `agent_workspace_grants`
  - Columns: `agentId`, `workspaceId`, `accessLevel` (`viewer | operator | manager`), `grantedBy`, timestamps.
  - Gap: workspace-only; cannot grant an agent into one channel, DM, project room, or team scope.

- `agent_access_grants`
  - Columns: `agentId`, `userId`, `grantedBy`, `canInteract`, `canConfigure`, `canViewLogs`.
  - Gap: user-to-agent only; not connected to scopes/channels or route-wide policy checks.

### Existing runtime tables

- `company_runtimes`
  - Columns include `companyId`, `ownerType`, `ownerUserId`, `ownerCompanyId`, `runtimeType`, gateway URLs, status.
  - Closed follow-up: `src/lib/runtime-scope-guard.ts` derives `personal | shared` from runtime ownership and blocks personal primary runtime invocation in shared chat contexts.
  - Remaining gap: no `runtime_scope_bindings` table that states exactly where each runtime may execute.

- `runtime_managed_resources`
  - Tracks runtime-managed external resources by `runtimeId`, `companyId`, `resourceType`, `resourceKey`, target agent refs.
  - Gap: this is inventory/sync state, not authorization.

### Existing chat/thread/pin tables

- `channels`
  - Columns: `companyId`, `workspaceId`, `type`, `name`, `slug`, `description`, `scopeType`, `scopeId`, `visibility`, default post/agent policies, creator, archive state, timestamps.
  - Remaining gap: the table exists, but route reads/writes still need to consistently enforce channel membership.

- `channel_members`
  - Columns: `channelId`, `memberType`, `userId`, `agentId`, `role`, `agentParticipationMode`, post/invite overrides, join actor, timestamps.
  - Includes partial unique indexes for `(channelId, userId)` and `(channelId, agentId)` and a Drizzle/database check for exactly one principal.
  - Remaining gap: policy helpers need to be wired through all chat/session/thread/pin routes.

- `chat_sessions`
  - Columns: `companyId`, `workspaceId`, `channelId`, `agentId`, `title`, `gatewaySessionKey`, thread parent fields.
  - Gap: no `scopeType`, `scopeId`, `createdByUserId`, conversation type, privacy label, or channel role.

- `chat_threads`
  - Columns: `companyId`, `workspaceId`, `channelId`, parent session/message fields, thread session fields, `agentId`.
  - Gap: thread visibility can now attach to `channelId`, but route enforcement still needs to prove channel membership.

- `chat_messages`
  - Columns: `sessionId`, `role`, `content`, `metadata`, `createdAt`.
  - Gap: no sender user/agent ids, no per-message visibility/audit fields, no denormalized scope columns for RLS/indexing.

- `chat_message_pins`
  - Columns: `companyId`, `workspaceId`, `sessionId`, `messageId`, `pinnedByUserId`.
  - Gap: pins are limited to three per session in route logic, but authorization is not channel/member aware.

- `saved_items`
  - Existing route usage shows `userId`, `companyId`, `workspaceId`, `sourceType`, `sourceId`, status/title/note/reminder/metadata.
  - Gap: user-owned saved item reads are scoped by `userId`, but source-resource access is not consistently re-validated.

### RLS state

No migrations defining `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `resource_grants`, `runtime_scope_bindings`, or `resource_promotions` were found in `drizzle/`. The `channels` and `channel_members` migration has since landed as `drizzle/0030_channel_membership.sql`.

## Route inventory and authorization observations

### Core access helpers

- `src/lib/require-auth.ts`
  - Accepts either heartbeat bearer token or NextAuth session.
  - It proves authentication only; it does not prove company/workspace/channel/resource authorization.

- `src/lib/workspace.ts`
  - `resolveAccessibleWorkspace` correctly rejects explicit workspace/company ids the current user or heartbeat runtime cannot access.
  - Heartbeat bearer access is restricted to the runtime's default workspace today; this is a seed for future `runtime_scope_bindings`.

- `src/lib/agent-access.ts`
  - `canReadAgent` uses owner, company role, visibility, and `agent_access_grants` logic.
  - It is not consistently invoked by chat execution/session routes before accepting an `agentId`/`gatewayAgent`/`targetAgent`.

- `src/lib/agent-route-auth.ts`
  - `resolveReadableAgentByCallsign` and related helpers can gate agent routes.
  - They are route-specific, not the unified policy engine described in `docs/plans/rbac-permissions-model.md`.

- `src/lib/collaboration-policy.ts`
  - Contains useful policy vocabulary/tests, but is not yet the mandatory authorization choke point for API routes.

### Chat/session/thread/pin routes

- `POST /api/chat` in `src/app/api/chat/route.ts`
  - Authenticates via `requireAuth` or `isValidVoiceUploadToken`.
  - Reads `companyId` from body/cookie and `workspaceId` from body/cookie, then persists to `chat_sessions` without first calling `resolveAccessibleWorkspace`.
  - Does not consistently verify the requested `agent`, `gatewayAgent`, or `targetAgent` is readable/invokable in the chosen scope.
  - Risk: authenticated users can attempt cross-company/workspace persistence or invoke agents outside intended visibility if downstream gateway checks do not stop it.

- `GET/POST /api/chat/sessions` in `src/app/api/chat/sessions/route.ts`
  - Authenticates only, then lists/creates by caller-supplied `companyId`.
  - Does not call `resolveAccessibleWorkspace` or validate `agentId` access.
  - This is the highest-priority route-level RBAC gap found.

- `GET/POST/DELETE /api/chat/messages` in `src/app/api/chat/messages/route.ts`
  - Stronger than sessions: explicit `companyId`/`workspaceId` paths call `resolveRequestedChatScope`, and `sessionId` paths call `loadAccessibleSessionById`.
  - Remaining gap: when creating by `agentId`, it verifies workspace access but not agent readability/invocation rights in that workspace.

- `/messages/thread/pin` coverage note
  - No literal route named `/messages/thread/pin` was found. The implemented pin endpoint is `src/app/api/chat/pins/route.ts`; thread linkage is represented by `chat_sessions.threadParent*` and `chat_threads`.
  - Treat future `/messages/thread/pin` UX/API work as needing the same policy as channel pins: member can read channel + member can pin in channel/thread.

- `GET/POST/DELETE /api/chat/pins` in `src/app/api/chat/pins/route.ts`
  - Authenticates only.
  - `GET` resolves `sessionId` from caller-supplied `sessionId` or `sessionKey + companyId/workspaceId`, then returns pins without `resolveAccessibleWorkspace`.
  - `POST` validates optional body `companyId`/`workspaceId` against the message's stored scope, but does not prove the user can access that scope.
  - `DELETE` deletes by `messageId` without scope/access validation.
  - Risk: cross-workspace pin read/write/delete by any authenticated session that knows ids.

- `GET /api/inbox/stats` in `src/app/api/inbox/stats/route.ts`
  - Uses `resolveAccessibleWorkspace` with `requireExplicitForBearer: true`; good direction.
  - Uses `sql.raw` with interpolated `workspace.id`. The id is resolved server-side, so injection risk is low, but parameterized SQL is still preferable.
  - It returns empty stats instead of `403` for unauthorized interactive users; this may be acceptable for privacy, but should be a deliberate policy constant.

- `GET/POST /api/saved-items` in `src/app/api/saved-items/route.ts`
  - Requires user session and filters saved items by `userId`.
  - Does not call `resolveAccessibleWorkspace` for requested `companyId`/`workspaceId` filters.
  - `POST` for `chat_message` source checks that optional caller scope matches the message, but does not prove the user can read the source message/session.
  - Risk is narrower because saved items are user-owned, but source leakage remains possible if a user knows a message id.

### Broader API inventory to include in follow-up policy migration

The repository has a large API surface under `src/app/api`. Routes importing `requireAuth`, `auth`, `resolveAccessibleWorkspace`, `canReadAgent`, or `getAgentAccessContext` include activity, agents, approval gates/requests, budgets, chat, companies/members, docs, inbox, mobile push, projects, runtimes, saved items, service secrets, skills, tasks, users, workspace files, and workspaces.

Follow-up migration should classify each route as one of:

- public/system health;
- authenticated user self-service;
- company admin;
- workspace member;
- channel member;
- resource owner/grantee;
- heartbeat/runtime bearer with `runtime_scope_bindings`;
- webhook/cron service identity.

## Additive schema gaps for the next implementation PRs

### 1. `channels`

Recommended columns:

- `id uuid primary key default_random()`
- `workspace_id uuid not null references workspaces(id)`
- `company_id uuid references companies(id)` denormalized for indexes/RLS
- `type text not null` with constants: `dm`, `channel`, `project_room`, `private_agent_chat`
- `scope_type text not null` with constants from `src/db/schema-access.ts`: `private:user`, `dm`, `channel`, `project`, `team`, `org`
- `scope_id text not null`
- `name text null` (nullable for DMs)
- `slug text null`
- `purpose text null`
- `created_by_user_id uuid references users(id)`
- `archived_at timestamptz null`
- timestamps

Indexes/constraints:

- unique `(workspace_id, slug)` where `slug is not null`
- index `(workspace_id, type)`
- index `(scope_type, scope_id)`
- index `(company_id, type)`

### 2. `channel_members`

Recommended columns:

- `id uuid primary key default_random()`
- `channel_id uuid not null references channels(id) on delete cascade`
- `member_type text not null` (`user | agent`)
- `user_id uuid references users(id)`
- `agent_id uuid references agents(id)`
- `role text not null` (`owner | admin | member | viewer` for users; `bot | assistant | observer` for agents)
- `agent_mode text null` (`mention_only | watching | proactive | on_call`)
- `added_by_user_id uuid references users(id)`
- `last_read_at timestamptz null`
- timestamps

Indexes/constraints:

- unique `(channel_id, user_id)` where `user_id is not null`
- unique `(channel_id, agent_id)` where `agent_id is not null`
- index `(user_id)` and `(agent_id)`

### 3. `resource_grants`

Generic additive grant table for docs/tasks/files/saved artifacts/runs until each resource has first-class membership.

Recommended columns:

- `id uuid primary key default_random()`
- `resource_type text not null`
- `resource_id uuid not null`
- `scope_type text not null`
- `scope_id text not null`
- `grantee_type text not null` (`user | agent | channel | project | team | org`)
- `grantee_id text not null`
- `permission text not null` (`read | comment | write | manage | invoke | audit`)
- `granted_by_user_id uuid references users(id)`
- timestamps

Indexes:

- unique `(resource_type, resource_id, grantee_type, grantee_id, permission)`
- index `(scope_type, scope_id)`
- index `(grantee_type, grantee_id)`

### 4. `runtime_scope_bindings`

Recommended columns:

- `id uuid primary key default_random()`
- `runtime_id uuid not null references company_runtimes(id) on delete cascade`
- `runtime_class text not null` (`personal | shared`)
- `scope_type text not null`
- `scope_id text not null`
- `workspace_id uuid references workspaces(id)`
- `company_id uuid references companies(id)`
- `allowed_actions text[] not null default '{}'`
- `created_by_user_id uuid references users(id)`
- timestamps

Policy invariant:

- `runtime_class = 'personal'` may bind only to `scope_type = 'private:user'` or owner-only DM scope.
- Shared scopes (`channel`, `project`, `team`, `org`) require `runtime_class = 'shared'` and company/workspace admin approval.

### 5. `resource_promotions`

Recommended columns:

- `id uuid primary key default_random()`
- `source_resource_type text not null`
- `source_resource_id uuid not null`
- `source_scope_type text not null`
- `source_scope_id text not null`
- `target_resource_type text not null`
- `target_resource_id uuid not null`
- `target_scope_type text not null`
- `target_scope_id text not null`
- `promotion_kind text not null` (`copy | summary | redacted_copy | link`)
- `redaction_policy text null`
- `field_manifest jsonb not null default '[]'`
- `promoted_by_user_id uuid references users(id)`
- timestamps

This table is required before private-to-shared sharing can be considered auditable.

### 6. Scope columns and indexes on existing tables

Add these columns conservatively and backfill from `workspace_id`/`company_id` where possible:

- `chat_sessions`: `channel_id`, `scope_type`, `scope_id`, `created_by_user_id`.
- `chat_threads`: `channel_id`, `scope_type`, `scope_id`.
- `chat_messages`: denormalized `workspace_id`, `company_id`, `channel_id`, `scope_type`, `scope_id`, `sender_user_id`, `sender_agent_id`.
- `chat_message_pins`: `channel_id`, `scope_type`, `scope_id`.
- `saved_items`: `source_scope_type`, `source_scope_id`, and optional `visibility_scope_type`/`visibility_scope_id` if saved artifacts become shareable.
- `inbox_messages`: keep `workspace_id`; add `scope_type`, `scope_id`, and recipient membership indexes.
- `tasks`, `projects`, `docs`, `skills`, `service_secrets`, `activity_log`: add/verify `scope_type`, `scope_id` and indexes where policy will query them.

Indexes should favor:

- `(workspace_id, scope_type, scope_id)`
- `(channel_id, created_at)` for messages
- `(scope_type, scope_id, created_at)` for audit/activity feeds
- `(company_id, workspace_id)` for admin views

### 7. Audit constants

Add TypeScript constants and matching DB check values for:

- `ScopeType`: `private:user`, `dm`, `channel`, `project`, `team`, `org`.
- `ChannelType`: `dm`, `channel`, `project_room`, `private_agent_chat`.
- `ActorType`: `user`, `agent`, `runtime`, `service`.
- `ResourceType`: `channel`, `chat_session`, `chat_message`, `thread`, `pin`, `saved_item`, `task`, `project`, `doc`, `skill`, `runtime`, `agent`, `file`, `approval`, `inbox_message`.
- `Action`: `read`, `create`, `send_message`, `pin`, `unpin`, `save`, `promote`, `invoke_agent`, `manage_members`, `manage_settings`, `audit`.
- Denial reason constants: `not_authenticated`, `not_workspace_member`, `not_channel_member`, `agent_not_visible`, `runtime_scope_forbidden`, `insufficient_role`, `resource_not_granted`.

## Policy engine shape

Create a single policy module, likely `src/lib/policy/`, that exposes:

- `buildActorContext(request)`
- `resolveScope(input)`
- `authorize({ actor, action, resource, scope })`
- `requireAuthorized(...)` for route handlers
- policy fixtures that can also generate/verify hosted Postgres RLS expectations

The engine should be the only place that maps company roles, channel roles, resource grants, agent visibility, runtime bindings, and heartbeat bearer identity to decisions.

## Hosted Postgres RLS plan

Do not make RLS mandatory for correctness. Add RLS after the TypeScript policy fixtures exist.

Initial hosted RLS mirror candidates:

- `channels`: readable by workspace/company admins and `channel_members`; writable by channel admins or workspace/company admins.
- `channel_members`: readable by members/admins; writable by channel admins or workspace/company admins.
- `chat_sessions`, `chat_threads`, `chat_messages`, `chat_message_pins`: readable/writable only through corresponding channel membership or private owner scope.
- `resource_grants`: readable by grant participants/admins; writable by admins/resource owners.
- `runtime_scope_bindings`: readable by admins/runtime owners; writable by workspace/company admins.
- `resource_promotions`: readable by source/target authorized readers; writable only through explicit promotion policy.

## Prioritized remediation list

1. Fix immediate route leaks before adding channels:
   - Add `resolveAccessibleWorkspace` to `GET/POST /api/chat/sessions`.
   - Add `resolveAccessibleWorkspace` and session-scope validation to all `GET/POST/DELETE /api/chat/pins` paths.
   - Add source access validation to `POST /api/saved-items` for `chat_message` sources.
   - Add `resolveAccessibleWorkspace` and `canReadAgent`/future `canInvokeAgent` to `POST /api/chat`.

2. Introduce `channels` + `channel_members` migrations and Drizzle schema.

3. Add `scope_type`/`scope_id` and `channel_id` columns to chat/session/thread/pin/message tables with conservative backfills.

4. Introduce the TypeScript policy engine and migrate chat routes to it.

5. Add `runtime_scope_bindings` and forbid personal runtimes in shared scopes.

6. Add `resource_grants` and `resource_promotions` before private-to-shared sharing UX ships.

7. Mirror tested policies into hosted Postgres RLS.

## Blockers and non-blockers

Blockers for implementation PRs:

- Decide exact enum/check-constraint strategy for Drizzle migrations: Postgres enums vs text + TypeScript constants. Recommendation: text + constants for scope/resource/action values during rapid iteration, then harden with check constraints once stable.
- Decide whether existing `chat_sessions` rows without `workspace_id` should be backfilled via `company_id` only or quarantined as legacy company-scoped sessions. Recommendation: backfill company workspaces from `company_id`; leave rows with neither workspace nor company inaccessible except to migration/admin repair tooling.

Not blockers:

- External guests: defer.
- Full RLS parity: defer until policy fixtures are stable.
- Rewriting all resources at once: channel/chat policy can land first, then `tasks`, `docs`, `skills`, `service_secrets`, and `inbox_messages` can follow.
