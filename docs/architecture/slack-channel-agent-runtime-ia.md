# Slack-like channel/chat IA with personal agents and runtimes

Status: draft implementation contract
Scope: CrewCmd chat/channel information architecture, schema migration order, and privacy invariants
Related: `/tenancy/governance`, `docs/plans/channel-scope-schema-migration-audit.md`, `docs/specs/chat-hierarchy-threading.md`, `docs/architecture/runtime-agent-access-v1.md`

## Product thesis

This is not a replacement for the existing CrewCmd collaboration design. It is a consolidation of the missing implementation steps that became visible while fixing the `#general` → `#crew` onboarding and noisy channel toolbar UX. The earlier direction was right; the gap was that the UI shipped ahead of a few load-bearing IA, policy, and DM/channel primitives.

CrewCmd should feel like Slack for hybrid human/agent teams: users live in **channels**, **DMs**, **project rooms**, and **threads**. Agents are present like teammates, but their runtimes and governance controls stay behind clear product boundaries.

The core product mistake to avoid is exposing backend tenancy words as the primary navigation model. **Workspace** remains important infrastructure, but the daily user model should be:

1. pick the team/account context only when necessary;
2. work in channels and DMs;
3. invite humans or agents to conversations;
4. let agents act only where they were explicitly invited or where governance grants allow it;
5. promote private runtime artifacts into shared spaces only through explicit, auditable actions.

## User-facing vocabulary

| Word | User-facing? | Meaning |
| --- | --- | --- |
| Team | Yes | The top-level company/account context users understand. Backed by `companies`. |
| Channels | Yes | Named group conversations like `#crew`, `#sales`, `#launch`. Backed by `channels(type='channel')`. |
| Project rooms | Yes | Channel-like rooms tied to a project. Backed by `channels(type='project_room', scopeType='project')`. |
| DMs | Yes | Private conversations between people, and optionally agents. Backed by `channels(type='dm')`. |
| Threads | Yes | Replies/work spawned from a message inside a channel/DM. Backed by `chat_threads` + child `chat_sessions`. |
| Agents | Yes | AI teammates that may join channels/DMs with a participation mode. Backed by `agents` + `channel_members`. |
| Runtimes | Admin/advanced | Execution homes for agents. Users should not need to pick a runtime in normal chat. |
| Workspace | Mostly no | Backend tenancy/default-scope/governance plumbing. Keep as an admin/debug concept until/unless a multi-workspace product story is deliberate. |
| Situation | No | Internal-only shorthand if retained. Never primary UI copy. |

## Navigation model

### Recommended app shell

```
Team switcher / admin context
└── Chat
    ├── Channels
    │   ├── #crew
    │   ├── #product
    │   └── #launch-room
    ├── Direct messages
    │   ├── Roger
    │   ├── Alice, Bob
    │   ├── Neo
    │   └── Roger, Neo
    └── Agent rooms / team agents (optional grouped section)
        ├── Neo
        ├── Cipher
        └── Sentinel
```

The current workspace switcher should **not** be removed until the tenancy story is settled, but it should stop being a central chat affordance. The safer path is:

1. keep it as an account/team context selector or admin/debug affordance;
2. rename/relocate it away from the message composer/header in normal chat;
3. hide it when the user only has one effective team/context;
4. never make channel membership depend on visible workspace selection alone.

This preserves optional multi-team/multi-account support without forcing users to understand `workspaceId` to send a message.

## Channel creation UX

Creating a channel should be a Slack-style modal, not an inline panel inside the message column.

Minimum modal fields:

- channel name;
- description/purpose;
- visibility: private/restricted/team-visible if supported;
- initial human members;
- optional agent members;
- default agent behavior: mention-only by default;
- optional project link if creating a project room.

Modal rules:

- default to `restricted`/private-ish, not company-wide;
- add creator as `owner`;
- invited humans become `member` unless elevated;
- invited agents become `member` with `agentParticipationMode='mention_only'` unless explicitly changed;
- no automatic membership from `companyId` alone.

## DMs: people, agents, and persona runtime chat

DMs should support all Slack-like combinations:

1. human ↔ human;
2. small human group DM;
3. human ↔ agent;
4. human group + one or more agents.

For CrewCmd, a human ↔ agent DM is the natural place to speak to that agent's persona/runtime, but the product should phrase it as **DM Neo** rather than **open runtime session**.

Implementation contract:

- DM is a `channels` row with `type='dm'` and no public slug.
- DM participants are explicit `channel_members` rows.
- The backing `chat_sessions` row owns the durable conversation for that DM.
- A user-owned personal agent can appear in the owner's private DM.
- A team-visible/company-owned agent can appear in team DMs if policy permits.
- Adding a private/personal agent into a team-visible DM requires explicit promotion/share workflow, not implicit access.

## Runtime privacy invariant

Personal runtimes are private execution homes. They must never be silently attached to team-visible surfaces.

Hard rules:

- `company_runtimes.ownerType='user'` may only bind to private/user-owned scopes for that user.
- Personal runtime sessions may produce artifacts, but artifacts are private until copied/promoted.
- Shared channels/project rooms/team tasks may use company-owned runtimes or explicitly shared agents only.
- Promotion from private to shared must create an audit event and preserve provenance.
- Existing `workspaceId`/`companyId` values are not enough to infer visibility.

This is the invariant that makes agent marketplaces and bring-your-own-runtime safe in a B2B product.

## Schema direction

Current schema already has early channel primitives:

- `channels(type, name, slug, scopeType, scopeId, visibility, defaultPostPolicy, defaultAgentMode)`
- `channel_members(memberType, userId, agentId, role, agentParticipationMode, overrides)`
- `chat_sessions(channelId, agentId, gatewaySessionKey, threadParent...)`
- `chat_threads(channelId, parentSession..., threadSession...)`

That is directionally right, but the model still needs a clearer scope/policy layer before deeper UI work.

### Needed additions/refinements

#### 1. Canonical scope vocabulary

Add shared constants/types before more migrations:

- `scopeType`: `private_user`, `dm`, `channel`, `project`, `team`, `org`
- `principalType`: `user`, `agent`, `runtime`, `company_role`
- `resourceType`: `chat_session`, `chat_message`, `thread`, `task`, `inbox_item`, `file`, `artifact`, `approval`, `skill`, `blueprint`
- `channelType`: `channel`, `dm`, `project_room`, `voice_room`
- `channelRole`: `owner`, `admin`, `member`, `contributor`, `viewer`, `guest`
- `agentParticipationMode`: `silent`, `watching`, `mention_only`, `proactive`, `on_call`

#### 2. Access/policy helper layer

Before relying on `channels`, centralize route checks:

- `canReadChannel(user, channel)`;
- `canPostToChannel(userOrAgent, channel)`;
- `canInviteMember(actor, channel, principal)`;
- `canBindRuntimeToScope(runtime, scope)`;
- `canPromoteResource(actor, resource, targetScope)`.

Routes should call helpers rather than open-coding `workspaceId`/`companyId` checks.

#### 3. Resource scopes and grants

Add after policy helpers are used by reads:

- `resource_scopes` or nullable scope columns on key resources;
- `resource_grants` for explicit cross-scope visibility;
- `resource_promotions` for private→shared copy/share audit trail;
- `runtime_scope_bindings` for execution eligibility.

#### 4. DM identity

Add a stable way to dedupe DMs:

- one-to-one DM unique by sorted participant principal keys within a company/team context;
- group DM unique only if intentionally reused, otherwise allow multiple titled group DMs;
- agent DMs include the agent as a participant, not as a special selected dropdown state.

## API direction

### Channels

- `GET /api/channels?teamId=...` returns only channels/DMs the viewer can read.
- `POST /api/channels` creates named channels/project rooms from the modal.
- `PATCH /api/channels/:id` updates channel metadata, archive state, visibility, and defaults.
- `GET/POST/DELETE /api/channels/:id/members` manages explicit human/agent membership.

### DMs

Add a DM-specific convenience API so the UI does not fake DMs with selected agents:

- `POST /api/dms/open`
  - body: `{ participants: [{type:'user', id}, {type:'agent', id}], initialMessage? }`
  - creates or returns the right `channels(type='dm')` row and backing `chat_session`.

### Chat messages

Chat send/read should key primarily by conversation/channel/session, not by global selected agent:

- channel message: send to `channelId` / backing `sessionId`;
- DM to agent: route to that agent's gateway session through the channel session;
- thread reply: inherit parent channel/DM scope.

The selected agent dropdown should become a participant/invite/action affordance, not the primary conversation selector.

## Frontend direction

### Sidebar

- Left rail: team/account switcher, global navigation.
- Chat sidebar: Channels, DMs, project rooms, agents if needed.
- Main pane: conversation only.
- Details pane: members, agents, files, pins, settings.

### Create channel modal

Replace inline channel management with a modal launched by `+` next to Channels.

### Start DM modal

Use one modal/search to start a DM with humans and agents. It should feel like Slack's “new message”, with agents appearing as people-like choices but labeled as agents.

### Agent interaction

- Mention agent in channel: `@Neo summarize this`.
- DM agent: opens private conversation with Neo.
- Add agent to channel/project room: explicit membership with mode.
- Agent tree/hierarchy remains useful in agent admin/monitoring, but not as the main chat navigation primitive.

## Missed implementation steps

The recent channel fixes exposed these missing steps:

1. the app had channel tables before the channel membership/policy layer became the central read/write authority;
2. the UI had channel controls before the final Slack-like IA decided where those controls should live;
3. the `#crew` default was implemented before legacy `#general` data normalization and selection behavior were fully deterministic;
4. agent chat still behaves partly like a selected-agent dropdown instead of explicit DM/channel participation;
5. workspace/team context is still too visible in normal chat even though it is mostly tenancy/governance plumbing;
6. personal runtime privacy needs to be encoded as a policy invariant before agents are allowed into shared channels and project rooms.

The next work should close those gaps in order instead of stacking more visual polish on the current model.

## Migration sequence

### PR 1: Gap contract + vocabulary

- land this architecture doc;
- add scope/channel/principal constants and tests;
- no behavior change.

### PR 2: Policy helpers

- add central channel/resource access helpers;
- update channel/chat reads to deny-by-default when membership/scope is ambiguous;
- tests for private runtime denial and missing-membership denial.

### PR 3: Channel creation modal

- replace inline create/manage UI with Slack-style modal;
- keep existing channel API;
- make `#crew` default selection deterministic;
- hide workspace selector for single-context users or move it to account/admin area.

### PR 4: DM primitives

- add `POST /api/dms/open`;
- support human-human, group human, human-agent, and mixed human-agent DMs;
- sidebar DM section lists explicit DMs instead of global selected-agent pseudo-chat.

### PR 5: Agent participation and mentions

- invite/remove agents from channels;
- support participation mode changes;
- route `@agent` messages and agent DM messages through the correct runtime safely.

### PR 6: Runtime bindings and promotions

- add `runtime_scope_bindings`, `resource_grants`, `resource_promotions`;
- preserve personal runtime privacy;
- audit private→shared promotion.

### PR 7: Project rooms/tasks/inbox integration

- project rooms tied to projects;
- task/inbox visibility inherits channel/project/private scope;
- human/agent task assignment uses the same principal vocabulary.

## Non-goals for the next UI PR

- do not remove `workspaceId` from the backend;
- do not make all company members implicit channel members;
- do not expose runtimes as normal chat destinations;
- do not infer shared visibility from old `workspaceId` rows;
- do not keep adding controls inside the message column.

## Open questions

1. Should the visible top-level selector say “Team” now, while `workspace` stays in URLs/API until migration completes?
2. Should project rooms be automatically created for every project or manually opt-in?
3. Should one-to-one human↔agent DMs reuse the agent's persistent gateway session or have a per-human wrapper session that routes to the agent runtime? The safer B2B answer is a per-DM wrapper session with explicit scope and provenance.
