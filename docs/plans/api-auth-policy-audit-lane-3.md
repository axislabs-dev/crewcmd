# API Auth Policy Audit — Lane 3

Date: 2026-05-14
Branch: `pixel/api-auth-audit-lane-3`
Scope: `src/app/api/{chat,tasks,inbox,agents,runtimes,audit-log}`

## Planning PR requirement

Every API route should answer these questions before touching data:

1. **actor** — who is calling: user, service identity, heartbeat runtime, or unauthenticated public probe.
2. **company/workspace** — which tenant boundary is selected, and how it was verified for the actor.
3. **scope** — which row/resource set is visible to the actor.
4. **action** — read, create, update, delete, execute, stream, or probe.
5. **policy** — the explicit authorization predicate for that action.
6. **audit** — whether the action should emit/query auditable security state.

This audit is intentionally docs-only. It identifies safe first route-slice PRs without changing live authorization behavior.

## Current helper surface

- `src/lib/require-auth.ts` only proves the request has a Supabase user session. It does not return an actor object and does not bind requested `companyId`, `workspaceId`, `sessionId`, `taskId`, or `agentId` to the user.
- `src/lib/workspace.ts` provides `resolveAccessibleWorkspace`, `isHeartbeatBearerRequest`, and bearer-specific explicit-scope handling. This is the strongest existing tenant-boundary helper for list/create routes that accept workspace/company input.
- `src/lib/heartbeat-auth.ts` validates `HEARTBEAT_SECRET`; routes using heartbeat/bearer service identity need explicit workspace/company parameters and should not silently fall back to broad reads.
- `src/lib/agent-access.ts` provides `getAgentAccessContext`, `canReadAgent`, `canUpdateAgent`, `canManageCompanyOwnedAgent`, `buildAgentReadWhere`, and `buildRuntimeReadWhere`. These are closer to the target policy model but are not consistently used by older nested agent routes.

## Route findings

### Chat routes

Representative files:

- `src/app/api/chat/messages/route.ts`
- `src/app/api/chat/sessions/route.ts`
- `src/app/api/chat/events/route.ts`
- `src/app/api/chat/pins/route.ts`
- `src/app/api/chat/runs/[id]/abort/route.ts`
- `src/app/api/chat/runs/[id]/visibility/route.ts`
- `src/app/api/chat/upload/route.ts`
- `src/app/api/chat/uploads/[...path]/route.ts`

Findings:

- Most chat routes call `requireAuth`, but then trust caller-supplied `sessionId`, `companyId`, `workspaceId`, `run id`, or upload path without a shared policy guard that proves the authenticated user can read/write that chat resource.
- `src/app/api/chat/messages/route.ts` reads/deletes/inserts by `sessionId` after `requireAuth`; the route also resolves sessions by caller-supplied `companyId`/`workspaceId` but does not use `resolveAccessibleWorkspace` or an equivalent chat-session visibility predicate.
- `src/app/api/chat/sessions/route.ts` requires `companyId` but does not verify membership in that company before listing or creating sessions.
- Upload/download routes authenticate the user, but the artifact path/session relationship should be policy-bound before returning bytes.

Risk:

- Authenticated users may be able to enumerate or mutate chat resources if they know opaque identifiers from another company/workspace.

Safe first PR:

- Add a chat policy helper/test around `canAccessChatSession(actor, sessionId | companyId/workspaceId, action)` before broad route rewrites. Start with `GET /api/chat/messages` as a negative invariant: a user without membership in a session's company/workspace must not receive messages by `sessionId`.

### Tasks routes

Representative files:

- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[id]/route.ts`
- `src/app/api/tasks/[id]/comments/route.ts`
- `src/app/api/tasks/[id]/complete/route.ts`
- `src/app/api/tasks/[id]/images/route.ts`
- `src/app/api/tasks/[id]/images/[index]/route.ts`
- `src/app/api/tasks/[id]/time-entries/route.ts`

Findings:

- `src/app/api/tasks/route.ts` is the best current pattern for list/create: it uses `resolveAccessibleWorkspace` and requires explicit workspace/company scope for heartbeat bearer requests.
- Nested task routes generally call `requireAuth` and then load by task id. They need a shared `visible-to-viewer` predicate before comments, completion, image, and time-entry operations touch task-adjacent data.
- The list route still has a fallback path for legacy global tasks where `workspace` is absent and the caller is not heartbeat bearer. That fallback should not become the pattern for team/global pages.

Risk:

- Authenticated users may access task children by id unless every nested route independently scopes through the task's workspace/company.

Safe first PR:

- Introduce a read-only task visibility helper, then enforce/test it on one low-risk nested route first, such as `GET /api/tasks/[id]/comments`. Keep `src/app/api/tasks/route.ts` as the reference for explicit bearer scope.

### Inbox routes

Representative files:

- `src/app/api/inbox/route.ts`
- `src/app/api/inbox/stats/route.ts`
- `src/app/api/inbox/[id]/route.ts`
- `src/app/api/inbox/bulk/route.ts`

Findings:

- `src/app/api/inbox/route.ts` uses `resolveAccessibleWorkspace` for list/create and requires explicit workspace/company scope for bearer listing.
- `src/app/api/inbox/stats/route.ts` does not call `requireAuth`, but it does use `resolveAccessibleWorkspace` and returns empty stats when no workspace resolves for non-bearer callers. This should be made explicit in the future actor model so `stats` is not an accidental anonymous route.
- `src/app/api/inbox/[id]/route.ts` and `src/app/api/inbox/bulk/route.ts` authenticate with `requireAuth`, but should also bind message ids to the actor's visible workspace/company before patching.
- Several inbox queries use raw SQL string interpolation after helper resolution. Even if values come from resolved workspace records, the policy foundation should prefer parameterized SQL/query builder predicates for auditability.

Risk:

- Inbox update/bulk endpoints may be id-based without tenant visibility checks unless the underlying helper enforces them elsewhere.

Safe first PR:

- Add an `inboxMessageVisibleToViewer` guard and enforce it for `PATCH /api/inbox/[id]` before expanding to bulk actions.

### Agents routes

Representative files:

- `src/app/api/agents/route.ts`
- `src/app/api/agents/[callsign]/route.ts`
- `src/app/api/agents/[callsign]/status/route.ts`
- `src/app/api/agents/[callsign]/output/route.ts`
- `src/app/api/agents/[callsign]/output/stream/route.ts`
- `src/app/api/agents/[callsign]/skills/route.ts`
- `src/app/api/agents/[callsign]/skills/[skillId]/route.ts`
- `src/app/api/agents/heartbeat/route.ts`

Findings:

- `src/app/api/agents/route.ts` uses the stronger pattern: `getAgentAccessContext`, `resolveAccessibleWorkspace`, explicit heartbeat scope, `listWorkspaceAgents`, and admin checks for org-owned creation.
- `src/app/api/agents/[callsign]/route.ts` uses `getAgentAccessContext`, `resolveAccessibleWorkspace`, `canReadAgent`, and `canUpdateAgent`, but still loads all agents and finds by callsign in memory before applying policy. That is acceptable as a transitional pattern but should become a scoped DB predicate.
- `src/app/api/agents/[callsign]/status/route.ts`, `output/route.ts`, and `output/stream/route.ts` resolve an agent by callsign and expose runtime status/output without `requireAuth` or agent visibility checks.
- `src/app/api/agents/[callsign]/skills/route.ts` and `skills/[skillId]/route.ts` attach/update/delete skills without `requireAuth` and load all agents by callsign. These are high-priority because they can modify runtime capabilities/secrets.
- `src/app/api/agents/heartbeat/route.ts` validates heartbeat auth; service identity should remain narrowly bound to heartbeat operations and should not become a general bypass for agent reads/writes.
- `src/app/api/agents/access/*` currently returns `409` without touching data, so it is low immediate risk despite no auth call.

Risk:

- Runtime output/status and skill assignment routes are the clearest unauthenticated or under-scoped agent surfaces in this slice.

Safe first PR:

- Start with a small guard helper for callsign-based routes: resolve agent plus `canReadAgent`/`canUpdateAgent` from `getAgentAccessContext`. Apply it first to `GET /api/agents/[callsign]/output` and `GET /api/agents/[callsign]/output/stream` or, if preferring mutation risk first, to `POST/PATCH/DELETE /api/agents/[callsign]/skills*`.

### Runtimes routes

Representative files:

- `src/app/api/runtimes/route.ts`
- `src/app/api/runtimes/[id]/route.ts`
- `src/app/api/runtimes/[id]/models/route.ts`
- `src/app/api/runtimes/import/route.ts`
- `src/app/api/runtimes/probe/route.ts`

Findings:

- `src/app/api/runtimes/route.ts` uses `getAgentAccessContext`, `buildRuntimeReadWhere`, `resolveAccessibleWorkspace`, and admin checks for company-owned creation.
- `src/app/api/runtimes/[id]/route.ts` requires authenticated user context before read/delete and checks user ownership or company admin rights. Note that read currently requires management rights for company-owned runtimes, which may be stricter than future read policy.
- `src/app/api/runtimes/[id]/models/route.ts` should be verified against the same runtime read guard before returning model data.
- `src/app/api/runtimes/import/route.ts` uses access context and workspace resolution; keep it in the runtime guard slice because import can create/update runtime-bound resources.
- `src/app/api/runtimes/probe/route.ts` has no app auth and supports gateway, local config, and paste modes. If this is intentionally pre-auth onboarding, document it as a narrow public probe with rate limiting and no tenant data access. Otherwise require an actor before probing local config or remote gateways.

Risk:

- Runtime probe is the main exception to the route-wide actor-first rule. Runtime model/import routes need consistency tests around `buildRuntimeReadWhere` and ownership checks.

Safe first PR:

- Add a runtime policy fixture that proves a runtime owned by company A is not readable/importable by a user from company B. Separately decide whether `/api/runtimes/probe` is public onboarding or authenticated-only.

### Audit log route

Representative file:

- `src/app/api/audit-log/route.ts`

Findings:

- The route calls `requireAuth`, then trusts caller-supplied `company_id` to query up to 500 audit entries.
- It does not verify the user's membership/admin/auditor role for the requested company before returning audit entries.
- The route is a high-sensitivity read surface because audit rows can expose actor identities, entity ids, actions, and timestamps.

Risk:

- Any authenticated user may be able to query audit logs for any known `company_id`.

Safe first PR:

- Enforce company membership plus a minimum role policy (recommended: admin/auditor once roles exist) before querying audit rows. This is a small, high-value route-slice PR.

## Prioritized implementation queue

1. **Policy foundation dependency**
   - Define a route-facing actor/policy return shape that includes `actorType`, `userId`, service identity, memberships, active company, workspace, action, and an audit decision.
   - Add negative test fixtures for cross-company access by id.
   - Keep heartbeat/service identity explicit and parameter-bound; no broad service bypass.

2. **Chat route slice**
   - Add chat-session/resource visibility helper.
   - First enforcement target: `GET /api/chat/messages` by `sessionId`.
   - Then cover delete/insert, sessions list/create, pins, events, runs, and upload paths.

3. **Tasks visible-to-viewer slice**
   - Promote the `src/app/api/tasks/route.ts` workspace pattern into a shared task guard.
   - First enforcement target: `GET /api/tasks/[id]/comments` or `GET /api/tasks/[id]`.
   - Then cover task children: images, time entries, completion, delete.

4. **Runtime guard slice**
   - Normalize runtime read/manage predicates around `buildRuntimeReadWhere` and `canManageCompanyOwnedAgent`.
   - Decide and document whether `/api/runtimes/probe` is public onboarding; if not, require actor before probe modes.
   - Add cross-company negative tests for runtime id/model/import access.

5. **Audit-log slice**
   - Require membership/admin/auditor policy before `.from(auditLog)`.
   - Add a test that an authenticated user outside `company_id` receives `403` and no rows.
   - Emit audit records for denied high-sensitivity audit-log reads once deny auditing exists.

## Suggested first safe PRs

1. **Docs/audit PR (this branch)** — land this audit artifact to align the next route-slice work.
2. **Audit-log guard PR** — one route, high-sensitivity data, clear membership check, simple negative test.
3. **Agent output/skill guard PR** — callsign guard helper plus one or two routes; avoid rewriting all agent routes.
4. **Chat messages guard PR** — shared chat session visibility helper plus `GET /api/chat/messages` negative invariant.
5. **Task comments guard PR** — visible-to-viewer helper plus `GET /api/tasks/[id]/comments` negative invariant.

## Verification for this artifact

- Direct inspection of the route files and auth helpers listed above.
- `git diff --check`.
