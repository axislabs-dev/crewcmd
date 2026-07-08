# Realtime Chat Sync Infrastructure - Design Spec

**Branch:** `docs/realtime-chat-sync-design`
**Author:** Blitz
**Date:** 2026-07-08
**Status:** Proposed

---

## Overview

CrewCMD needs a reliable, self-hostable realtime sync layer so crew chat and
personal chat appear across web, desktop, and mobile clients without a manual
refresh. A message sent from mobile should arrive on desktop/web, and a message
sent from desktop/web should arrive on mobile, in the correct channel, direct
message, agent session, and thread.

The product should treat the database as the source of truth and realtime as a
notification and recovery stream over that truth. The default deployment target
is a single CrewCMD instance with its application database. SaaS and
multi-instance fanout can layer on top later without changing the client event
contract.

## Problem Statement

Today chat persistence and live updates exist, but they are not a complete
cross-device event stream contract:

- Live fanout is process-local and best effort.
- Replay uses timestamps, not an ordered cursor.
- Some chat write paths persist messages without publishing live events.
- Event payloads mix message and progress shapes without a durable envelope.
- Current-thread, unread, and optimistic send reconciliation are mostly client
state, so multiple devices can diverge.
- Mobile/WebView lifecycle events can suspend the client, making timestamp
catch-up and in-memory unread counts brittle.

The failure mode is product-visible: one device sends or receives chat content,
another signed-in device does not see it until refresh or history reload, or the
message lands in a broad agent bucket instead of the exact scoped thread.

## Goals

1. Make chat sync reliable for one self-hosted CrewCMD server and one database.
2. Use durable database rows as the source of truth for messages, progress, and
   sync cursors.
3. Provide a realtime notification stream with ordered event ids and replay from
   `Last-Event-ID` or `lastEventId`.
4. Scope every event to the correct workspace, company, channel, chat session,
   gateway session key, and thread.
5. Keep web, desktop, and mobile clients convergent after reconnect, app resume,
   refresh, or duplicate event delivery.
6. Preserve existing chat APIs during rollout and migrate in small PRs.
7. Leave a clean path to multi-instance fanout with Postgres `LISTEN/NOTIFY`,
   Redis, or managed gateways.

## Non-Goals

- Replacing OpenClaw or Hermes runtime streaming protocols.
- Building global SaaS fanout in the first slice.
- Adding typing indicators, presence, collaborative cursors, or reactions in the
  first slice.
- Guaranteeing exactly-once network delivery. The design provides at-least-once
  delivery with idempotent clients.
- Making push notifications the sync source. Push can wake or notify mobile, but
  replay from the database remains authoritative.
- Changing public CLI commands, config formats, or workflow semantics.

## Current Architecture Observations

### Chat persistence and response streaming

- `POST /api/chat` persists the user message before sending the turn to the
  gateway when a company or workspace scope is available
  (`src/app/api/chat/route.ts:1069`).
- `persistAndPublish` writes to `chat_messages`, touches `chat_sessions`, and
  publishes a process-local event through `publishChatEvent`
  (`src/app/api/chat/route.ts:815`).
- The same route streams the initiating HTTP response as SSE and also persists
  the final assistant message before publishing it
  (`src/app/api/chat/route.ts:1484`).
- Progress events are persisted into `chat_session_events` and published through
  the same in-memory bus (`src/app/api/chat/route.ts:1179`).
- The route filters raw gateway events by `sessionKey`, related agent ids, and
  active run id before treating them as the current turn
  (`src/app/api/chat/route.ts:1565`).

### Direct message persistence path

- `POST /api/chat/messages` can save messages directly and create or reuse a
  scoped session (`src/app/api/chat/messages/route.ts:328`).
- That path writes `chat_messages` and updates `chat_sessions`, but it does not
  currently publish a chat event (`src/app/api/chat/messages/route.ts:411`).
  External integrations using this route can therefore persist data without
  waking other clients.

### Existing chat event endpoint

- `GET /api/chat/events` authenticates, resolves an accessible company scope,
  and opens an SSE stream (`src/app/api/chat/events/route.ts:20`).
- Catch-up uses `since=<ISO timestamp>`, then queries matching company sessions,
  messages, and progress events (`src/app/api/chat/events/route.ts:70`).
- Live updates subscribe to the in-memory chat pub/sub and filter by `companyId`
  and `canAccessChatSession` (`src/app/api/chat/events/route.ts:152`).
- Heartbeats are comments every 30 seconds (`src/app/api/chat/events/route.ts:170`).
- The response is `text/event-stream` with `Cache-Control: no-cache`
  (`src/app/api/chat/events/route.ts:195`).

### In-memory fanout

- `src/lib/chat-pubsub.ts:1` explicitly describes the chat bus as
  "Single-process only".
- The bus stores no cursor, replay window, or durable event id. A process restart
  or a second server process loses live notifications until the client performs
  an explicit history fetch.

### Database shape

- `channels` and `channel_members` already model channel visibility and
  membership (`src/db/schema.ts:959`, `src/db/schema.ts:991`).
- `chat_sessions` contain `companyId`, `workspaceId`, `channelId`, `agentId`,
  `gatewaySessionKey`, and thread parent fields (`src/db/schema.ts:1030`).
- `chat_threads` aggregate parent/thread session links
  (`src/db/schema.ts:1052`).
- `chat_messages` contain the message body and session id, but not denormalized
  company, workspace, channel, sender, or sequence columns
  (`src/db/schema.ts:1083`).
- `chat_session_events` stores progress/audit payloads for a session, but has no
  event sequence or client replay contract (`src/db/schema.ts:1113`).
- `chat_runs` tracks active/completed runs for mobile completion notification
  and abort behavior (`src/db/schema.ts:1151`).

### Client behavior

- `ChatEventProvider` is mounted globally under `Providers`, so it can feed chat
  state no matter which page is active (`src/components/providers.tsx:15`).
- The provider opens `EventSource` against `/api/chat/events` and sends a
  timestamp cursor from `lastEventAt` (`src/components/chat/chat-event-provider.tsx:64`).
- It routes message events into the Zustand store by
  `chatConversationStoreKey(sessionKey ?? agentId, channelId)`
  (`src/components/chat/chat-event-provider.tsx:74`).
- The chat store deduplicates by message id, sorts by `createdAt`, increments an
  unread counter, and records `lastEventAt` (`src/lib/chat-store.ts:48`).
- The store already has optimistic reconciliation helpers by id and by persisted
  server message (`src/lib/chat-store.ts:70`, `src/lib/chat-store.ts:86`).

### Mobile and background behavior

- Mobile push exists for completed agent replies and includes `sessionId`,
  `sessionKey`, and `messageId` in the payload (`src/lib/mobile-push.ts:65`).
- Push is optional and environment-gated (`src/lib/mobile-push.ts:51`).
- The chat route keeps a gateway turn alive after passive client disconnect so a
  locked phone or suspended WebView can resume from persisted history
  (`src/app/api/chat/route.ts:1550`).

### Related realtime precedent

- Runtime run events already forward `Last-Event-ID` to a provider stream
  (`src/app/api/runtimes/[id]/runs/[runId]/events/route.ts:40`).
- The Hermes provider forwards `Accept: text/event-stream` and `Last-Event-ID`
  for run events (`src/lib/runtimes/providers/hermes.ts:163`).
- This gives CrewCMD an internal precedent for cursor-based SSE recovery even
  though chat events do not yet use it.

## Proposed Architecture

Use a durable append-only event log for client sync, plus a lightweight
single-process fanout hub for low-latency notification.

```
chat writer / integration / runtime bridge
  -> validate auth and scope
  -> write domain row(s): chat_messages, chat_session_events, chat_runs, etc.
  -> append realtime_events row in the same transaction or same retry unit
  -> publish event id to in-process fanout

SSE client
  -> authenticate and request company/workspace/channel scope
  -> replay realtime_events after cursor
  -> subscribe to in-process fanout
  -> re-read each event from DB or use committed event payload
  -> emit SSE frames with id: <sequence>
```

The event log is the source of truth for "what changed"; the domain tables are
the source of truth for the current state and full message history.

### New Durable Event Log

Introduce a generic `realtime_events` table rather than another chat-only table.
Chat is the first consumer, but the same infrastructure can later support inbox,
tasks, approvals, and runtime status.

Recommended columns:

| Column | Purpose |
| --- | --- |
| `sequence` | Monotonic bigint identity. This is the replay cursor and SSE `id`. |
| `id` | UUID event id for logs, tracing, and idempotency if sequence is internal. |
| `type` | Stable event type, for example `chat.message.created`. |
| `resourceType` | `chat_message`, `chat_progress`, `chat_session`, `chat_thread`, etc. |
| `resourceId` | The primary domain row id when available. |
| `companyId` | Company boundary for auth and broad subscription. |
| `workspaceId` | Workspace boundary for auth and narrower future subscriptions. |
| `channelId` | Channel/DM/project room boundary when present. |
| `sessionId` | CrewCMD `chat_sessions.id` when present. |
| `sessionKey` | Runtime/gateway session key for client routing. |
| `threadParentSessionKey` | Parent thread key when the event belongs to a thread. |
| `threadSessionKey` | Thread session key when the event belongs to a thread. |
| `actorType` | `user`, `agent`, `runtime`, or `system`. |
| `actorId` | User id, agent callsign/id, runtime id, or null. |
| `payload` | Small JSON payload needed to update the client without refetch. |
| `occurredAt` | Event time from the database. |
| `createdAt` | Insert time. Usually the same as `occurredAt`. |

Index recommendations for v1:

- `(company_id, sequence)`
- `(workspace_id, sequence)`
- `(channel_id, sequence)`
- `(session_id, sequence)`
- `(created_at)` for retention cleanup
- Optional partial index on `(type, sequence)` for tests and diagnostics

Use `sequence` as the primary replay cursor because timestamps can collide,
clock skew can reorder events, and `createdAt` is already used as display data.

### Write Contract

Every write path that changes chat-visible state must append one or more
`realtime_events` rows:

- `POST /api/chat` user message: append `chat.message.created`.
- `POST /api/chat` assistant final: append `chat.message.created`.
- `POST /api/chat` progress: append `chat.progress.updated` or
  `chat.progress.completed`.
- `POST /api/chat/messages`: append `chat.message.created`.
- Message clear/delete later: append `chat.message.deleted` or
  `chat.session.cleared`.
- Pin/save/read receipts later: append their own typed events.

Writers should append the event in the same database transaction as the domain
row when the adapter supports transactions. If a local adapter does not support a
multi-statement transaction, use the existing `withRetry` boundary and prefer:

1. Persist domain row.
2. Append event row.
3. Publish fanout notification.

If the publish step fails, recovery still works because clients replay from the
database after reconnect or heartbeat timeout.

### Fanout Contract

For the single-instance default, keep an in-process hub, but change what it
publishes:

- Publish only committed event descriptors: `{ sequence, companyId, workspaceId,
  channelId, sessionId }`.
- The SSE route should use the descriptor to filter obvious mismatches, then
  emit the event payload from the committed DB row.
- If the process restarts, no event is lost durably. Connected clients reconnect
  and replay from their last sequence.

This keeps v1 self-hostable with no Redis, no separate queue, and no managed
service.

## Transport Recommendation

Use Server-Sent Events as the default client notification transport for v1.

### Why SSE

- Chat sync is server-to-client notification; sends already happen through HTTP
  POST routes.
- Browser and desktop web clients have native `EventSource`.
- SSE has built-in reconnect semantics and a standard `Last-Event-ID` header.
- It works over normal HTTP infrastructure and is easier to self-host than a
  WebSocket upgrade path.
- CrewCMD already uses SSE for chat response streaming, chat events, agent
  output, runtime events, and realtime voice relay.
- Mobile clients can use an EventSource implementation while foregrounded and
  rely on durable replay plus push notifications when backgrounded.

### Why not WebSocket first

WebSocket would be useful for bidirectional realtime features such as typing
indicators, presence, collaborative cursors, or client-side acknowledgements.
Those are not required to solve reliable cross-device message sync. Starting
with WebSocket would add connection lifecycle, proxy, heartbeat, backpressure,
and auth complexity without removing the need for a durable event cursor.

### SSE Details

Endpoint options:

- Keep `/api/chat/events` and evolve it in place.
- Or introduce `/api/realtime/events` for generic events and leave
  `/api/chat/events` as a compatibility wrapper.

Recommended first implementation: evolve `/api/chat/events` to support durable
cursor replay while preserving `since` temporarily. Add `/api/realtime/events`
only when a second product surface uses the same event log.

Frame format:

```text
id: 1042
event: chat.message.created
data: {"id":"evt_...","sequence":"1042","type":"chat.message.created",...}

```

Heartbeat:

```text
: ping 2026-07-08T02:00:00.000Z

```

Headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

## Event Model

### Envelope

All client-visible events should share this envelope:

```json
{
  "id": "evt_8f5a1...",
  "sequence": "1042",
  "type": "chat.message.created",
  "occurredAt": "2026-07-08T02:00:00.000Z",
  "scope": {
    "companyId": "co_...",
    "workspaceId": "ws_...",
    "channelId": "ch_...",
    "sessionId": "sess_...",
    "sessionKey": "agent:main:neo",
    "threadParentSessionKey": null,
    "threadSessionKey": null
  },
  "actor": {
    "type": "user",
    "id": "user_..."
  },
  "resource": {
    "type": "chat_message",
    "id": "msg_..."
  },
  "payload": {
    "message": {
      "id": "msg_...",
      "role": "user",
      "content": "Hello",
      "metadata": {
        "clientMessageId": "client_..."
      },
      "createdAt": "2026-07-08T02:00:00.000Z"
    }
  }
}
```

The envelope should be versioned by type, not by adding a global `v2` field to
every event. If a payload changes incompatibly, add a new event type.

### Initial Event Types

| Type | Resource | Client effect |
| --- | --- | --- |
| `chat.message.created` | `chat_message` | Insert or reconcile a message in one conversation. |
| `chat.progress.updated` | `chat_progress` | Update active run/progress UI. |
| `chat.progress.completed` | `chat_progress` | Close active progress UI and keep audit history. |
| `chat.session.updated` | `chat_session` | Refresh session list, title, updated time, or preview. |
| `chat.thread.updated` | `chat_thread` | Refresh thread summary/reply count for a parent message. |
| `sync.resync_required` | `sync` | Client must refetch snapshots because replay gap is too large. |

Later event types can cover read receipts, pins, saved items, inbox messages,
task comments, and approval state.

### Scope Rules

Every event must carry the narrowest known scope:

- Company and workspace are required for authenticated dashboard users.
- Channel id is required for channel, DM, and project-room events.
- Session id is required when the event belongs to a CrewCMD chat session.
- Session key is required when the event routes to a runtime/gateway
  conversation.
- Thread keys are required when the event belongs to a message thread.

Subscription filters:

- v1 clients subscribe by company or workspace.
- The server filters every event through `resolveAccessibleWorkspace` and, when
  `channelId` is present, `canAccessChatSession` or the future policy engine.
- Clients still route by exact event scope. They must not use broad company
  subscription as permission to display a message in an unrelated thread.

### Auth and Workspace Boundaries

The event endpoint should use the same policy as chat reads:

- Normal users authenticate through the NextAuth session cookie.
- Runtime bearer auth remains route-specific and should require explicit
  `workspaceId` or `companyId` when supported.
- A user can receive an event only if they can read the referenced chat session
  or channel at delivery time.
- The event log may store all events, but replay queries must filter to
  accessible events before sending payloads.
- Do not trust client-supplied `companyId`, `workspaceId`, `channelId`,
  `sessionId`, or `sessionKey` as authorization proof.

## Persistence and Recovery Semantics

### Delivery Guarantees

The realtime stream provides:

- Durable ordering by `sequence`.
- At-least-once delivery.
- Idempotent client application by `event.id`, `sequence`, and resource ids.
- Bounded replay from `Last-Event-ID` or `lastEventId`.

It does not provide:

- Exactly-once network delivery.
- Infinite replay.
- Ordering across events the server never persisted.

### Connect Flow

1. Client opens `/api/chat/events?companyId=...&lastEventId=...`.
2. Server authenticates and resolves an accessible workspace/company.
3. Server reads `Last-Event-ID` header first, then `lastEventId` query param,
   then the legacy `since` timestamp during migration.
4. Server replays accessible events where `sequence > lastEventId`, ordered by
   sequence, up to a bounded page size.
5. If more replay remains, server can continue paging before subscribing, or
   emit a `sync.resync_required` event and ask the client to fetch snapshots.
6. Server subscribes to in-process fanout and sends new committed events.

### Reconnect Flow

1. `EventSource` reconnects automatically with `Last-Event-ID` when supported.
2. Clients should also persist the last applied sequence in local storage or
   native secure storage and pass it as `lastEventId`.
3. On mobile resume, focus, or `pageshow`, close and reopen the stream with the
   stored last sequence.
4. If the stream returns `sync.resync_required`, fetch `/api/chat/messages` for
   active conversations, refresh session/thread summaries, then store the
   returned high-water sequence.

### Retention

Keep enough event rows for realistic offline windows. Suggested default:

- 7 days for self-hosted default.
- Configurable by `CREWCMD_REALTIME_EVENT_RETENTION_DAYS`.
- Never delete domain rows through event retention.

If a client reconnects with a cursor older than retention, send
`sync.resync_required` and include the current high-water sequence.

### Backpressure

SSE replay should be paged:

- Default replay page: 500 events.
- Hard cap per connection before resync: 5,000 events.
- Payloads must remain small. Large attachments stay referenced by id/url and
  are fetched through existing authorized endpoints.

## Client Integration

### Web and Desktop

Keep one global provider, but change its cursor model:

- Replace `lastEventAt` with `lastEventId` or `lastSequence`.
- Store last applied sequence in the Zustand store and durable browser storage.
- Parse SSE `event:` names and the shared envelope.
- Route messages by exact `scope.channelId`, `scope.sessionKey`,
  `scope.threadSessionKey`, and `scope.sessionId`.
- Deduplicate by event sequence and by message id.
- Keep a compatibility path for legacy `type: "message"` events only during
  rollout.

### Mobile

Foreground mobile behavior should match web:

- Open the same SSE endpoint using the native/WebView EventSource client.
- Persist the last applied sequence in native storage.
- Reconnect on app foreground/resume with `lastEventId`.

Background behavior:

- Do not assume JS timers, fetches, audio callbacks, or EventSource keep running.
- Use push notifications as wake/attention hints only.
- On push open or app resume, replay from the durable cursor before rendering
  the target conversation.

### Optimistic Send Reconciliation

The client should attach a stable `clientMessageId` to each optimistic user
message:

```json
{
  "metadata": {
    "clientMessageId": "client_018..."
  }
}
```

Server behavior:

- Persist `clientMessageId` in `chat_messages.metadata`.
- Include it in `chat.message.created`.
- Continue sending immediate `meta` events on the initiating `POST /api/chat`
  response during compatibility.

Client behavior:

- Insert optimistic message immediately in the exact scoped conversation.
- When `chat.message.created` arrives with matching `clientMessageId`, replace
  the optimistic id with the persisted message id.
- If the same persisted event arrives on another device, insert it normally.
- If the sender receives both the POST stream meta and the global event,
  deduplicate by message id and client message id.

### Current Thread and Unread Behavior

Unread state should become scope-aware and eventually durable:

- Conversation key should include channel id plus session/thread key.
- A message in the active visible conversation should not increment unread.
- A message from the current user should not increment unread on that device.
- Other devices should mark the message read only after they display the active
  conversation, not merely because the sender displayed it elsewhere.
- Store per-conversation `lastReadSequence` locally in v1.
- Add a durable `chat_conversation_reads` table later if cross-device read
  receipts and unread counts need to survive reinstall or new devices.

Current-thread behavior:

- When viewing a parent session, thread events should update thread summaries but
  not append messages to the parent transcript.
- When viewing a thread session, parent session events should update parent
  context/summaries but not append messages to the thread transcript.
- Channel DMs and personal agent chats must route by `channelId` when present so
  the same `sessionKey` cannot collide across scopes.

## Single-Instance Deployment Story

The default self-hosted deployment needs only:

- One CrewCMD Next/Node server process.
- One configured database.
- The application process in-memory fanout hub.

No Redis, queue, sidecar, or managed realtime service is required.

Operational notes:

- The database owns recovery, so process restarts are acceptable.
- SSE requires a runtime that supports long-lived HTTP responses. The primary
  self-hosted target should be a Node server, not a serverless platform with
  short request lifetimes.
- Reverse proxies should disable response buffering for the SSE endpoint.
- Health metrics should include connected clients, replay count, replay lag,
  publish count, stream errors, and resync-required count.

## Future Multi-Instance and SaaS Path

The durable event log lets CrewCMD add fanout without changing clients.

### Postgres LISTEN/NOTIFY

Recommended first multi-instance step:

1. Insert `realtime_events`.
2. `NOTIFY crewcmd_realtime, '<sequence>'`.
3. Every app instance listens, loads the event row by sequence, filters local
   subscribers, and emits SSE.

Pros:

- No extra infrastructure beyond Postgres.
- Good fit for self-hosters who already use Postgres.
- Keeps DB as source of truth.

Cons:

- Notifications are not durable by themselves.
- Payload size is limited, so only send sequence ids.
- Requires connection management outside serverless request handlers.

### Redis Pub/Sub or Redis Streams

Redis pub/sub can fan out low-latency notifications between instances while the
database remains authoritative. Redis Streams can also provide durable replay,
but using both DB and Redis as durable stores adds complexity. Prefer DB replay
plus Redis notification unless there is a clear throughput need.

### Managed Gateways

Ably, Pusher, NATS, or a cloud pub/sub gateway can serve SaaS scale and edge
delivery later. They should consume the same durable event rows and publish the
same envelope. Managed gateways should not become the only copy of chat events.

### WebSocket Layer

WebSocket can be added later for bidirectional realtime UX:

- Typing indicators.
- Presence and active device state.
- Explicit client acknowledgements.
- Collaborative editing or shared cursors.

The WebSocket protocol should still use `sequence` cursors and the same event
envelope for persisted events.

## Migration and Rollout Plan

Keep each PR small and reviewable.

1. **Docs-only design.** Land this spec.
2. **Schema foundation.** Add `realtime_events` schema/migration, indexes, and
   retention config. Add unit tests for cursor ordering and query filters.
3. **Event append helper.** Add a server helper such as `appendRealtimeEvent`
   and an in-process fanout hub that publishes committed sequences.
4. **Chat writer integration.** Update `POST /api/chat`,
   `POST /api/chat/messages`, and chat progress persistence to append events.
   Keep existing `chat-pubsub` during compatibility.
5. **Cursor SSE endpoint.** Evolve `/api/chat/events` to emit `id:` and
   `event:` frames, replay by `Last-Event-ID`, and retain `since` as a temporary
   fallback.
6. **Client cursor migration.** Update `ChatEventProvider` and `chat-store` to
   track `lastSequence`, route event envelopes, and reconcile optimistic sends.
7. **Unread/current-thread cleanup.** Make unread increments scope-aware and
   active-conversation-aware. Add local `lastReadSequence`.
8. **Compatibility removal.** Remove timestamp-only replay and legacy message
   event shapes after web, desktop, and mobile clients consume the envelope.
9. **Multi-instance notification.** Add Postgres `LISTEN/NOTIFY` or Redis fanout
   only when deployment needs exceed one server process.

## Testing Plan

### Unit Tests

- Event envelope validation rejects missing scope for chat events.
- `appendRealtimeEvent` writes monotonically increasing sequences.
- Replay query returns events in sequence order and respects company/workspace
  and channel membership.
- Client reducer deduplicates duplicate event delivery.
- Optimistic reconciliation replaces a local message by `clientMessageId`.
- Current active conversation does not increment unread.
- Parent session and thread events route to distinct store keys.

### API Tests

- `/api/chat/events` accepts `Last-Event-ID` and `lastEventId`.
- Replay returns only accessible events.
- Replaying after an old cursor emits `sync.resync_required`.
- `POST /api/chat/messages` now emits a durable realtime event.
- Chat progress events replay after reconnect.
- The endpoint keeps legacy `since` behavior only while the migration requires
  it.

### E2E Tests

- Two browser contexts signed in to the same company:
  - Send message in context A.
  - Assert it appears in context B without refresh.
  - Send reply in context B.
  - Assert it appears in context A without refresh.
- Same test inside a channel and a personal/direct chat.
- Thread test:
  - Send parent message.
  - Send thread reply.
  - Assert parent summary updates and thread transcript receives the reply.
- Reconnect test:
  - Open both contexts.
  - Disconnect one EventSource.
  - Send several messages.
  - Reconnect with last event id.
  - Assert all messages arrive once and in order.
- Mobile lifecycle simulation:
  - Persist last sequence.
  - Simulate app background by closing EventSource.
  - Send message from desktop.
  - Resume mobile and replay from cursor.

### Failure Modes to Exercise

| Failure | Expected behavior |
| --- | --- |
| Process restarts after event append but before publish | Client reconnect replays from DB. |
| Process publishes duplicate notification | Client deduplicates by sequence/event/message id. |
| Client offline longer than retention | Server emits `sync.resync_required`; client refetches snapshots. |
| User loses channel access before replay | Server filters events at replay/delivery time. |
| Message write succeeds but event append fails | Writer logs error; repair job can backfill event from domain row, or client history fetch still sees message. |
| Event append succeeds but domain payload is deleted | Event should be ignored or transformed into resync-required depending on resource type. |
| Mobile receives push while backgrounded | Push opens app; app replays from stored cursor before showing chat. |
| Same session key exists in two channels | Store key includes channel id, so messages do not collide. |

## Open Questions

1. Should v1 introduce a generic `/api/realtime/events` immediately, or keep
   `/api/chat/events` until a second product surface needs the event log?
2. Should `realtime_events.sequence` be a DB identity bigint exposed as a string,
   or should CrewCMD expose opaque ids and keep sequence internal?
3. Should `chat_messages` gain denormalized company/workspace/channel/sender
   columns in the same migration as the event log, or remain session-joined for
   the first realtime PR?
4. How long should the default self-hosted event retention be: 7 days, 14 days,
   or configurable only?
5. Should read/unread state stay local for v1, or should the realtime foundation
   include durable `chat_conversation_reads` immediately?
6. Should external integrations using `POST /api/chat/messages` be required to
   pass `clientMessageId` or an idempotency key?
7. Which deployment targets officially support long-lived SSE in v1, and should
   unsupported serverless targets get a documented polling fallback?

## Acceptance Criteria

The realtime sync foundation is complete when:

1. A message persisted on one device appears on another active device without
   refresh.
2. A disconnected client can reconnect with a cursor and receive missed events
   in order.
3. Duplicate delivery does not duplicate messages or unread counts.
4. Events are delivered only to users who can read the scoped conversation.
5. Channel, DM, personal chat, parent session, and thread events route to the
   correct store keys.
6. Mobile resume replays from the durable cursor before displaying stale chat.
7. The single-instance deployment works without Redis or managed realtime infra.
8. The event contract can be fanned out later by Postgres `LISTEN/NOTIFY`,
   Redis, or a managed gateway without changing client payloads.
