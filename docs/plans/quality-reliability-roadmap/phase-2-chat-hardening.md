# Phase 2: Chat Reliability and Transparency

## Goal

Remove long opaque periods where the user cannot tell whether an agent is
thinking, using tools, blocked, or disconnected.

## Core Problem

CrewCmd's current chat route can wait on gateway `chat.send` before the browser
receives useful stream progress. If the runtime blocks during reasoning or tool
work, the user may see no meaningful status for a long time.

ClawX handles this more defensively:

- It records the user message optimistically.
- It starts progress tracking before awaiting `chat.send`.
- It listens to gateway lifecycle and chat events.
- It polls `chat.history` during active runs.
- It renders thinking, tool calls, tool results, and spawned sessions as an
  execution graph.

CrewCmd should adopt the same reliability pattern, adapted for server-side
Next routes and multi-runtime operation.

## Workstreams

### 1. Return Chat SSE Immediately

Tasks:

- Create the `ReadableStream`.
- Return the SSE `Response` immediately.
- Start `client.chatSend` asynchronously after the stream is established.
- Emit an initial `run_pending` or `gateway_send_started` event.
- Ensure stream cleanup aborts the gateway run and releases the pooled client.

Acceptance criteria:

- The browser receives headers and an initial event before `chat.send` resolves.
- A test can simulate `chat.send` hanging while progress still reaches the
  client.

### 2. Structured Chat Stream Events

Tasks:

- Add event frames alongside text deltas:
  - `run_started`
  - `heartbeat`
  - `thinking`
  - `tool_call`
  - `tool_result`
  - `session_spawned`
  - `history_snapshot`
  - `run_completed`
  - `run_error`
  - `run_aborted`
- Include stable metadata:
  - `runId`
  - `sessionKey`
  - `agentId`
  - `runtimeId`
  - `elapsedMs`
  - `lastEventAt`
- Keep OpenAI-compatible text delta frames for existing UI compatibility during
  the transition.

Acceptance criteria:

- Existing text streaming still works.
- New structured events can drive a progress UI without parsing assistant text.

### 3. Active-Run History Polling

Tasks:

- Poll `chat.history` after a short delay when no useful event arrives.
- Continue polling during active runs while no live delta is available.
- Merge history snapshots without duplicating optimistic messages.
- Surface assistant thinking/tool messages discovered only through history.
- Stop polling on final, abort, terminal error, or explicit user cancellation.

Acceptance criteria:

- If gateway event streaming is sparse, the UI still shows progress from
  authoritative history.
- Polling is bounded and does not continue after run completion.

### 4. Client Active-Run State

Tasks:

- Track:
  - current `runId`
  - current `sessionKey`
  - `isSending`
  - `lastEventAt`
  - `lastHistoryPollAt`
  - active tool name
  - active subagent/session
  - terminal status
- Filter stale events by `runId` and `sessionKey`.
- Treat aborts as first-class state transitions.
- Keep partial assistant content when a run is cancelled or interrupted.

Acceptance criteria:

- Switching agents cannot leak events into the wrong chat.
- Cancelling a run does not allow late events to re-arm the UI.

### 5. Execution Progress UI

Tasks:

- Add a compact execution panel to chat.
- Show current status even before the first assistant text token.
- Start simple:
  - Agent run started
  - Thinking
  - Calling tool
  - Waiting on subagent
  - Completed
  - Error
- Later add richer graph behavior similar to ClawX.

Acceptance criteria:

- Users can tell whether an agent is alive, using tools, waiting, or done.
- The panel remains useful on mobile and desktop.

## Suggested PR Sequence

1. `fix: return chat stream before gateway send completes`
2. `feat: emit structured chat progress events`
3. `feat: poll chat history during active runs`
4. `feat: track active chat run state`
5. `feat: show chat execution progress`
6. `test: cover long-running chat progress`

## Verification

Targeted tests should cover:

- `chat.send` blocks but the client receives progress.
- Gateway emits lifecycle events before `chat.send` returns.
- Gateway emits no deltas, but `chat.history` reveals tool activity.
- User aborts before `runId` is known.
- Late stale events are ignored.
- Partial content is persisted on disconnect.

Manual smoke checklist:

- Send a normal message.
- Send a tool-heavy message.
- Send a delegated/subagent task.
- Cancel mid-run.
- Switch agents during a run.
- Refresh while a run is active.

## Risks

- Returning SSE immediately changes route timing and cleanup behavior.
- History polling can duplicate messages if merge keys are weak.
- Too much progress UI can become noisy if not grouped clearly.

## Rollback Plan

Keep text delta streaming backward compatible. If structured progress causes a
UI regression, disable the progress panel while retaining the safer immediate
SSE response path.
