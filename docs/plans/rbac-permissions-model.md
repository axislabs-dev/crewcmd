# CrewCmd RBAC and Permissions Model

## Objective

Define the complete permissions model for CrewCmd's channel/chat-first collaborative AI architecture across database scope, RLS/app policy, API authorization, runtime routing, admin flows, and frontend affordances.

The model must make collaborative AI safe by default:

- Personal work is private unless explicitly shared.
- Shared channels use only approved shared runtimes and shared agents.
- Every resource page is a permission-filtered lens, never a raw global query.
- Admin flows are explicit, auditable, and testable.
- UI visibility is helpful, but backend authorization is authoritative.

## Non-Negotiable Invariants

1. **Personal runtime isolation**
   - A user-owned OpenClaw runtime can only be used for that user's private chats, private agents, and private resources.
   - It is never attachable to shared channels, company agents, team-visible tasks, shared automations, org skills, or shared voice sessions.

2. **Private-by-default personal outputs**
   - Anything created from a private chat or personal agent defaults to `private:user` scope.
   - This includes tasks, inbox items, docs, files, automations, skills, blueprints, summaries, saved items, and voice transcripts.

3. **Explicit promotion only**
   - Private resources become shared only through an explicit share/promote action.
   - Promotion copies or derives selected fields/artifacts/summaries. It does not expose the private thread, hidden prompt, private memory, private runtime config, or raw context.

4. **Permission-filtered reads**
   - Team/global pages must never read raw `all tasks`, `all inbox items`, `all docs`, or `all chats`.
   - They must query resources visible to the viewer through scope membership and role checks.

5. **Backend enforcement first**
   - API handlers, server actions, runtime routing, and background jobs must call shared authorization helpers.
   - Frontend checks are only convenience and clarity.

6. **Auditable privilege changes**
   - Role changes, channel membership changes, agent invitations, runtime bindings, scope promotions, approvals, and policy overrides emit audit events.

## Scope Model

Every scoped resource should resolve to exactly one canonical visibility scope plus optional secondary links.

| Scope | Meaning | Default membership | Typical resources |
| --- | --- | --- | --- |
| `private:user:<userId>` | Private owner-only work | Owner only | Private chats, personal-agent tasks, private docs, personal automations |
| `dm:<conversationId>` | Direct conversation | Explicit DM members | Human DMs, human+agent private group chats |
| `channel:<channelId>` | Shared channel/chat | Channel members | Channel messages, channel tasks, pinned docs, channel files |
| `project:<projectId>` | Project room/context | Project members and configured linked channel members | Project tasks, project docs, project automations |
| `team:<teamId>` | Functional team | Team members | Team channels, team agents, team skills |
| `org:<companyId>` | Company-wide | Company members, filtered by role | Org agents, approved skills, global blueprints |

Implementation note: existing `workspaceId` and `companyId` remain partitioning and tenancy fields. Additive scope fields should carry user-visible collaboration scope.

Recommended additive fields for scoped resources:

```ts
scopeType: "private" | "dm" | "channel" | "project" | "team" | "org";
scopeId: string;
ownerUserId?: string;
companyId?: string;
createdFromScopeType?: string;
createdFromScopeId?: string;
visibilityReason?: "owner" | "member" | "assignee" | "approver" | "admin" | "shared";
```

## Role Layers

CrewCmd needs layered permissions because company membership, channel membership, project membership, and agent/runtime administration are different concerns.

### 1. System role

Existing `users.role` remains platform-level access.

| Role | Can do |
| --- | --- |
| `super_admin` | Instance-wide break-glass administration, diagnostics, user support, system settings |
| `admin` | Instance administration where enabled by deployment policy |
| `viewer` | Normal authenticated user baseline |

System role must not bypass personal runtime isolation except explicit super-admin diagnostics that never expose secrets or private prompt context in shared UI.

### 2. Company role

Existing `company_members.role` should govern company administration.

| Company role | Can do |
| --- | --- |
| `owner` | Full company administration; transfer ownership; delete company; manage admins; manage billing; manage shared runtimes; export audit logs |
| `admin` | Invite/manage members except owners; manage company settings; manage shared runtimes; manage org agents/skills/blueprints; configure default channel policies |
| `member` | Create permitted channels/projects/tasks; participate in assigned channels; use allowed team/org agents |
| `viewer` | Read visible channels/resources; comment where allowed; cannot invoke costly agents or mutate shared configuration unless specifically granted |

### 3. Channel role

Add channel membership roles for shared chats.

| Channel role | Read | Post | Invite humans | Invite/remove agents | Configure channel | Manage resources | Archive/delete |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | Yes | Yes | Yes | No delete unless policy allows |
| `member` | Yes | Yes | No by default | Mention allowed agents only | No | Create scoped tasks/docs | No |
| `contributor` | Yes | Yes, limited | No | Mention only | No | Create assigned tasks/comments | No |
| `viewer` | Yes | No or comments only | No | No | No | No | No |
| `guest` | Limited | Limited | No | No | No | Limited to explicit resources | No |

Channel roles should be independent from company roles. A company admin can administer policy, but ordinary channel posting still follows channel membership unless an explicit admin override is logged.

### 4. Project role

Project rooms need resource authority beyond chat.

| Project role | Can do |
| --- | --- |
| `owner` | Manage project settings, membership, linked channels, automations, archives |
| `manager` | Create/assign tasks, invite project agents from allowed pool, configure project automations |
| `member` | Work tasks, comment, upload docs/files, mention permitted agents |
| `viewer` | Read visible project resources |
| `guest` | Read/comment on explicitly shared items only |

### 5. Agent role/capability

Agent access needs capability grants because using an agent and configuring it are very different.

| Capability | Meaning |
| --- | --- |
| `agent.view` | See agent profile/basic status |
| `agent.invoke` | Mention/run agent in an allowed scope |
| `agent.configure` | Edit prompt/config/model/profile/skills within allowed policy |
| `agent.manage_membership` | Add/remove the agent from channels/projects |
| `agent.view_logs` | Read invocation logs and summaries, excluding hidden/private prompt context |
| `agent.manage_budget` | Set spend limits and approval thresholds |
| `agent.retire` | Disable/archive agent |

Personal agents grant all capabilities to their owner only. Team/org agents grant capabilities through company/channel/project policy.

### 6. Runtime capability

Runtime permissions must be separate from agent permissions.

| Capability | Personal runtime | Shared runtime |
| --- | --- | --- |
| View runtime status | Owner only | Company owner/admin; optionally operators |
| Invoke through agent | Owner's private chats only | Allowed shared agents in allowed scopes |
| Attach to channel | Never | Owner/admin, with policy checks |
| Attach to personal agent | Owner only | No, unless creating a company-owned agent |
| Configure credentials | Owner only | Company owner/admin |
| Export logs | Owner only | Company owner/admin/auditor, redacted |

## Proposed Database Additions

Prefer additive migrations over rewrites.

### Channels and membership

```ts
channels
- id
- companyId
- workspaceId nullable
- type: "channel" | "dm" | "project_room" | "voice_room"
- name nullable for DMs
- slug nullable
- description nullable
- scopeType
- scopeId
- visibility: "private" | "restricted" | "team" | "org"
- defaultPostPolicy
- defaultAgentMode
- createdByUserId
- archivedAt
- createdAt / updatedAt

channel_members
- id
- channelId
- memberType: "user" | "agent"
- userId nullable
- agentId nullable
- role: "owner" | "admin" | "member" | "contributor" | "viewer" | "guest"
- agentParticipationMode: "silent" | "watching" | "mention_only" | "proactive" | "on_call" nullable
- canPostOverride nullable
- canInviteOverride nullable
- joinedByUserId
- createdAt / updatedAt
```

### Scope metadata for existing resources

Add scope columns to:

- `chat_sessions`
- `chat_threads`
- `chat_messages` where message-level exceptions are needed
- `tasks`
- `inbox_messages`
- `projects`
- `docs`
- `skills`
- `team_blueprints`
- `saved_items`
- `approval_requests`
- `activity_log`
- `chat_runs`
- voice transcript/session tables when present

Recommended columns:

```ts
scopeType
scopeId
ownerUserId
createdFromScopeType
createdFromScopeId
sharedFromResourceType
sharedFromResourceId
sharedByUserId
sharedAt
```

### Policy grants

```ts
resource_grants
- id
- resourceType
- resourceId
- principalType: "user" | "agent" | "channel" | "project" | "team" | "org"
- principalId
- permissions: string[]
- grantedByUserId
- reason
- expiresAt nullable
- createdAt
```

Use this for exceptions, not as the default path for every common read.

### Runtime binding policy

```ts
runtime_scope_bindings
- id
- runtimeId
- scopeType: "private" | "channel" | "project" | "team" | "org"
- scopeId
- allowedAgentId nullable
- createdByUserId
- createdAt
```

Hard rule: a runtime with `ownerType = "user"` may only have `scopeType = "private"` and `scopeId = ownerUserId`.

### Promotion/audit trail

```ts
resource_promotions
- id
- sourceResourceType
- sourceResourceId
- sourceScopeType
- sourceScopeId
- destinationResourceType
- destinationResourceId
- destinationScopeType
- destinationScopeId
- promotedFields: string[]
- redactionSummary
- promotedByUserId
- createdAt
```

Every promotion also writes `audit_log`.

## RLS and App-Layer Policy

CrewCmd should use a shared authorization engine even where database-level RLS is not available or not reliable in local/self-hosted modes.

### Recommended stance

1. **Policy engine is mandatory** in TypeScript and used by every API route/server action/background job.
2. **Postgres RLS is a defense-in-depth mirror** for hosted Postgres deployments.
3. **PGlite/local dev uses policy engine tests** to guarantee behavior even without production RLS semantics.

### Core policy helpers

```ts
canReadResource(actor, resource): boolean
canCreateResource(actor, scope, resourceType): boolean
canUpdateResource(actor, resource, patch): boolean
canDeleteResource(actor, resource): boolean
canPostToChannel(actor, channel): boolean
canInviteChannelMember(actor, channel, member): boolean
canMentionAgent(actor, channel, agent): boolean
canBindRuntime(actor, runtime, scope): boolean
canPromoteResource(actor, source, destinationScope, fields): boolean
assertRuntimeAllowedForScope(runtime, scope): void
assertAgentAllowedInScope(agent, scope): void
```

### RLS policy shape

For each scoped table:

- `SELECT`: actor is owner, direct member, assigned human, approver, channel/project/team/org member with sufficient role, or explicit grant.
- `INSERT`: actor can create resource in requested scope; default private scope is applied server-side when missing.
- `UPDATE`: actor can update fields allowed by role; scope-changing updates require promotion path.
- `DELETE`: owner/admin only; soft-delete preferred for shared artifacts.

RLS policies must not allow broad company member reads unless the resource is explicitly `org` scoped.

## API Authorization Contract

Every API route should answer these questions before touching data:

1. Who is the actor? (`userId`, system role, company role, service identity, heartbeat/runtime identity)
2. What company/workspace partition is active?
3. What scope is requested or inferred?
4. What action is being attempted?
5. Which policy helper authorizes it?
6. What audit event is required?

### Required API route updates

| API area | Required authorization behavior |
| --- | --- |
| `/api/chat/*` | Sessions/messages filtered by channel/chat membership; post requires `channel.post`; agent invocation checks channel membership, agent capability, and runtime binding |
| `/api/tasks/*` | List visible tasks only; create defaults private unless channel/project scope provided and allowed; assignment checks assignee visibility |
| `/api/inbox/*` | List visible inbox items only; action requires recipient/approver/admin authority |
| `/api/projects/*` | Membership-filtered project reads; project admin controls membership/linked channels |
| `/api/agents/*` | Personal agents owner-only; team/org agents visibility by scope; invoke/configure split |
| `/api/runtimes/*` | Personal runtime owner-only; company runtime admin/operator-only; binding checks hard privacy invariant |
| `/api/skills/*` | Private installs owner-only; shared installs require admin/policy approval; shared agents can only use allowed skills |
| `/api/blueprints/*` | Private drafts owner-only; org templates visible by policy; publishing requires promote/admin path |
| `/api/docs/*` and files | Scope-filtered reads; uploads inherit channel/project/private scope |
| `/api/approval-*` | Approver-only decisions; audit every decision |
| `/api/audit-log` | Owner/admin/auditor reads only; never leaks private hidden context |

### Service identities

Heartbeat secrets, runtime callbacks, and background jobs must not become all-powerful bypasses.

They should carry a service actor with constrained capabilities:

- runtime heartbeat: update runtime/agent status only;
- agent run callback: append messages/events only for the authorized run/session;
- cron/background task: operate only in the scope specified at job creation;
- super-admin maintenance: explicitly marked and audited.

## RBAC Administration Flow

### Company member administration

Location: company settings / team admin.

Owner/admin can:

1. Invite user with company role.
2. Change role subject to hierarchy rules.
3. Suspend/remove member.
4. Transfer ownership.
5. Review member's channel/project memberships.
6. Review shared agents/runtimes the member can administer.

Rules:

- Only owner can create/remove owners or transfer ownership.
- Admin cannot demote owner.
- Removing a member removes channel/project memberships and disables their shared resource assignments, but does not delete shared audit history.
- Removing a member leaves their private resources private/inaccessible unless account deletion/export policy handles them separately.

### Channel administration

Location: channel details/settings side panel.

Channel owner/admin can:

1. Rename/archive channel.
2. Invite/remove humans.
3. Set member roles.
4. Add/remove allowed team/org agents.
5. Set each agent participation mode.
6. Set posting/invite/task creation policy.
7. Link project/automation resources.
8. Review audit/provenance for channel promotions.

Company owner/admin can recover or archive orphaned channels, but that action must be audited.

### Agent administration

Location: agent detail/settings.

Admins should manage:

- ownership: personal/team/org;
- visibility;
- allowed scopes;
- allowed channels/projects;
- runtime binding;
- skills;
- model profile;
- budget;
- logs/audit access;
- participation defaults.

The UI must visually separate:

- personal agent on personal runtime;
- team/org agent on shared runtime;
- imported runtime agent;
- disabled/offline/unavailable agent.

### Runtime administration

Location: company settings > runtimes and personal settings > my runtime.

Personal runtime admin:

- owner can connect/disconnect their own runtime;
- owner can use it only for private chats/personal agents;
- no shared-channel attach control is shown.

Company runtime admin:

- owner/admin can connect shared runtime;
- owner/admin can allow it for org/team/project/channel scopes;
- runtime binding displays which agents/channels can use it;
- rotating/removing credentials requires confirmation and audit.

### Promotion administration

Location: share modal and audit/provenance views.

Promotion flow:

1. User chooses `Share to channel/project/team/org`.
2. UI shows selected fields/artifacts only.
3. Server computes redaction boundary.
4. Server checks `canPromoteResource`.
5. Server creates destination resource or shared copy.
6. Server writes `resource_promotions` and `audit_log`.
7. Destination channel shows provenance: “Shared by Roger from a private chat; private context excluded.”

## Frontend Requirements

### Navigation

- Far-left rail: app modes such as Chat, Tasks, Inbox, Projects, Agents, Skills/Automations, Settings.
- Chat sidebar: Recents, DMs, private agent chats, channels, project rooms, starred/on-call.
- Main pane: active channel/chat.
- Right context pane: scope badge, members, agents, tasks, approvals, files, automations, runtime/agent policy.

### Permission clarity

Every channel/chat should show:

- scope badge: Private / DM / Channel / Project / Team / Org;
- who can read;
- who can post;
- which agents are present;
- each agent's participation mode;
- runtime class: personal/team/org, never raw secret details;
- share/promote affordance where applicable.

Disabled controls should explain why:

- “Only channel admins can invite agents.”
- “This is your personal runtime; it cannot be attached to shared channels.”
- “You can read this channel but cannot post.”
- “This agent is not approved for this project.”

### Resource pages

Tasks, Inbox, Projects, Automations, Team/Agents, Skills, and Blueprints should support:

- visible scope filters;
- mine/private/channel/project/team/org filters;
- clear provenance for shared/promoted items;
- creation flows that default to the current channel/chat scope when opened from chat;
- creation flows that default to private scope when opened from private agent chats.

## Test Plan

### Unit tests

- Policy helper matrix for every role/scope/action.
- Personal runtime cannot bind to shared channel/project/team/org scopes.
- Personal agent cannot be invited to shared channel unless converted/promoted through an explicit safe flow; default should reject.
- Private-resource promotion copies selected fields only.
- Viewer/member/admin/owner field-level update rules.

### API route tests

- `/api/chat/sessions`: user sees only memberships and own private chats.
- `/api/chat/messages`: post denied without channel permission; agent mention denied without `agent.invoke` and runtime binding.
- `/api/tasks`: list filters by visibility; create defaults private from private chat; channel task creation requires channel membership.
- `/api/inbox`: private agent inbox item invisible to company admin unless explicitly shared or assigned.
- `/api/runtimes`: company admin cannot attach another user's personal runtime to a shared channel.
- `/api/agents`: configure denied to ordinary channel member; invoke allowed only where policy grants it.
- `/api/skills`/`/api/blueprints`: private vs shared visibility and publish/promote path.

### Integration tests

- Create private chat → create task → task visible only to owner.
- Share selected private output to channel → channel members see shared copy and provenance; private thread remains hidden.
- Add team agent to channel → mention succeeds with shared runtime.
- Attempt to add personal agent/runtime to channel → rejected server-side and UI displays reason.
- Remove user from channel → user loses access to channel messages/tasks/files but audit remains.
- Company admin changes role → allowed/denied according to hierarchy and audit event recorded.

### RLS/policy tests

- Hosted Postgres RLS policies match TypeScript policy helper fixtures.
- PGlite/local tests run policy helper fixtures even if DB-level RLS is unavailable.
- No route uses raw unscoped `select()` for scoped resources without policy filtering.

### Frontend tests

- Scope badges render correctly.
- Disabled controls show permission reason.
- Channel member management allows only valid role transitions.
- Agent participation mode controls are visible only to channel admins.
- Resource pages do not show inaccessible private resources.

## Implementation Checklist

### Foundation

- [ ] Add canonical authorization types and policy helper module.
- [ ] Add channel/chat scope enums and constants.
- [ ] Add audit event constants for permission-relevant actions.
- [ ] Add test fixtures for owners/admins/members/viewers/guests, personal runtime, shared runtime, private chat, shared channel, project room.

### Database

- [ ] Add `channels` and `channel_members`.
- [ ] Add scope columns to existing scoped resources.
- [ ] Add `resource_grants`, `runtime_scope_bindings`, and `resource_promotions`.
- [ ] Backfill existing personal chat sessions/tasks/inbox/resources to private or workspace/company scope safely.
- [ ] Add indexes for `(scopeType, scopeId)`, owner, company, and membership lookups.
- [ ] Add hosted Postgres RLS policies where supported.

### API

- [ ] Route every read through visible-to-viewer helpers.
- [ ] Route every mutation through action-specific assertions.
- [ ] Split agent `view`, `invoke`, `configure`, `logs`, and `budget` checks.
- [ ] Split runtime `view`, `configure`, `bind`, and `invoke` checks.
- [ ] Add explicit promote/share endpoints.
- [ ] Add audit events for admin and promotion flows.

### Frontend

- [ ] Add channel/chat navigation model.
- [ ] Add channel settings/member admin UI.
- [ ] Add agent participation controls.
- [ ] Add scope badges and runtime class indicators.
- [ ] Add permission-aware empty states and disabled-control explanations.
- [ ] Update resource pages into scope-filtered lenses.

### Documentation

- [ ] Document canonical terminology.
- [ ] Document RBAC matrix.
- [ ] Document runtime privacy invariant.
- [ ] Document promotion flow.
- [ ] Document API authorization contract.
- [ ] Document RLS/app policy split for self-hosted deployments.

### Quality gates

- [ ] Unit policy matrix passes.
- [ ] API authorization tests pass.
- [ ] Frontend permission tests pass.
- [ ] Migration/backfill tests pass.
- [ ] `git diff --check` passes.
- [ ] Typecheck/lint/test pass or blockers are documented with exact existing failures.

## Open Design Decisions

These should be decided before implementation starts, not left to individual PRs:

1. Are channels a new first-class table immediately, or typed `chat_sessions` in the first migration?
2. Do DMs use `channels(type = "dm")` or remain separate private chat sessions?
3. Is company `viewer` allowed to post in public org channels, or read-only everywhere by default?
4. Should channel `guest` exist in v1, or wait until external collaboration is implemented?
5. Which shared resources are copied on promotion versus changed in place?
6. How much audit detail is visible to channel admins versus company owners?
7. Should hosted Postgres RLS be mandatory for production, or defense-in-depth behind the TypeScript policy engine?
