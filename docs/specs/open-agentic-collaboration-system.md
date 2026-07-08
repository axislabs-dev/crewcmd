# Open agentic collaboration system

Status: early RFC
Scope: CrewCmd-owned agentic collaboration layer, open agent adapters, orchestration, and self-hosted defaults
Related: `docs/concepts/agents.md`, `docs/specs/chat-hierarchy-threading.md`, `docs/specs/openclaw-integration.md`, `docs/architecture/runtime-agent-access-v1.md`, `docs/architecture/runtime-contract-definitions.md`, `docs/architecture/slack-channel-agent-runtime-ia.md`

## Purpose

CrewCmd should become an open agentic collaboration system: a Slack-like place where humans and many kinds of agents can share rooms, DMs, threads, tasks, files, approvals, and work state.

The key idea is that CrewCmd should not only integrate OpenClaw, Hermes, or one model provider. It should provide the collaboration and orchestration layer that lets different agent systems join the same team environment through explicit contracts.

The target experience:

- a user can invite an agent into a channel, DM, project room, or task;
- that agent might be backed by OpenClaw, Hermes, a local OpenAI-compatible endpoint, a remote hosted model, an MCP server, a custom company service, or a future CrewCmd worker;
- humans see one consistent collaboration surface regardless of the runtime behind the agent;
- self-hosted deployments work without managed realtime, managed queues, or a SaaS-only runtime;
- more advanced SaaS infrastructure can be added later without changing the user model.

## Product thesis

CrewCmd should own the room, not the agent runtime.

External systems can bring intelligence, tools, and execution. CrewCmd should provide the durable social and operational layer around them:

- identity and membership;
- channel, DM, thread, task, and project context;
- realtime sync;
- permissions and governance;
- memory and retrieval policy;
- tool approval and audit;
- run lifecycle;
- human interruption and handoff;
- observability and cost tracking.

This makes CrewCmd useful even when no single agent runtime wins. A team can run local models, company-hosted agents, OpenClaw nodes, Hermes workers, and provider APIs side by side while still working in one shared collaboration product.

## Core decision

An agent runtime is not the product boundary. A CrewCmd agent is.

CrewCmd should model an agent as:

```text
CrewCmd agent identity
  -> membership in rooms/tasks
  -> policy and permissions
  -> context/memory/tool configuration
  -> runtime adapter binding
  -> orchestrated runs and events
```

The runtime behind that identity can vary. The collaboration contract stays stable.

## Definitions

### Agent

A CrewCmd-owned teammate identity that can participate in rooms, DMs, tasks, and workflows.

CrewCmd owns:

- callsign, display name, avatar, role, and description;
- visibility and ownership;
- room/task membership;
- participation mode;
- policy, budgets, and approval rules;
- context and memory policy;
- runtime binding;
- run state and audit history.

### Runtime

The execution home or inference provider behind an agent.

Examples:

- OpenClaw;
- Hermes;
- OpenAI-compatible local or hosted endpoints;
- MCP-backed tool services;
- company-owned agent services;
- future CrewCmd-managed workers.

### Adapter

The CrewCmd integration layer for one class of runtime.

Adapters normalize runtime differences into CrewCmd events:

- send input;
- receive output deltas;
- request tool calls;
- report status;
- cancel or interrupt;
- surface errors;
- expose capabilities.

### Orchestrator

The CrewCmd service that turns conversation and task events into governed agent runs.

Responsibilities:

- decide which agents should respond;
- resolve scope, permissions, and context;
- build the instruction envelope;
- route to the correct adapter;
- execute or request approval for tools;
- persist messages, run state, and audit events;
- publish realtime updates;
- recover after disconnects, retries, or process restarts.

### Room

A Slack-like collaboration surface:

- channel;
- project room;
- DM;
- group DM;
- thread;
- task discussion;
- future voice/live room.

Rooms are the primary user-facing place where humans and agents meet.

## Non-goals

This early RFC does not require CrewCmd to:

- run arbitrary untrusted code from third-party agents;
- treat all external agent protocols as equally capable;
- build a distributed workflow engine before basic room participation works;
- require Redis, NATS, Kafka, or hosted realtime for single-instance self-hosting;
- let private/personal runtimes silently join shared team rooms;
- make agent autonomy the default in every channel;
- hide provenance of which runtime produced which output.

## Runtime and agent classes

CrewCmd should support multiple classes under one agent model.

| Class | Examples | CrewCmd role |
| --- | --- | --- |
| Native agent runtime | OpenClaw, Hermes | Sync richer runtime semantics while CrewCmd governs room participation. |
| Compatible model endpoint | Ollama, LM Studio, vLLM, OpenRouter, LiteLLM | CrewCmd wraps inference with agent identity, context, tools, and run state. |
| Agent service endpoint | A company-owned HTTP service, future Open Agent spec services | CrewCmd treats the service as an agent backend behind a CrewCmd identity. |
| Tool/service runtime | MCP servers, internal tools | CrewCmd exposes tools to agents through policy, not as chat participants by default. |
| CrewCmd worker | Future built-in worker | CrewCmd owns the full execution loop. |

The important distinction is participation. A runtime may power an agent, but only a CrewCmd agent joins a room.

## Slack-like behavior target

The open agentic system should feel like a collaborative workplace, not a bot console.

Expected behavior:

- messages appear across web, desktop, and mobile without refresh;
- humans and agents can share channels, DMs, threads, and project rooms;
- agents can be invited, removed, muted, or changed to mention-only;
- agent output is streamed into the same message timeline as human messages;
- long-running work creates visible run state rather than disappearing into logs;
- users can interrupt, approve, retry, hand off, or summarize agent work;
- private chats stay private unless explicitly promoted;
- every message and action has provenance.

## Participation modes

Agents should not all behave like noisy bots.

Suggested modes:

| Mode | Behavior |
| --- | --- |
| `silent` | Can read only if policy allows; never responds automatically. |
| `mention_only` | Responds when mentioned or directly assigned. Default for shared rooms. |
| `watching` | May prepare context or suggestions, but does not post without action. |
| `on_call` | Can respond to channel-level requests and task events. |
| `proactive` | Can initiate messages under explicit room policy. |
| `automated` | Runs scheduled or workflow-driven actions with visible audit. |

Default shared-room behavior should be `mention_only`. Proactive behavior should be explicit and auditable.

## System architecture

Single-instance self-hosted default:

```text
Human/client event
  -> CrewCmd API
  -> durable message/event log
  -> orchestration planner
  -> pending agent run
  -> runtime adapter
  -> model/agent/runtime
  -> output/tool/status events
  -> durable log
  -> realtime stream to clients
```

Core services:

- `rooms`: channels, DMs, project rooms, threads, and task discussions;
- `agents`: identity, membership, profile, mode, and policy;
- `runtimes`: configured execution homes and model/service endpoints;
- `adapters`: runtime-specific bridges;
- `orchestrator`: run planning, context, tools, retries, and cancellation;
- `event_log`: durable event source for sync and recovery;
- `realtime`: SSE/WebSocket client stream over durable events;
- `audit`: provenance, approvals, tool use, and policy decisions.

## Adapter contract

Adapters should normalize runtime capabilities without pretending every runtime can do everything.

Minimum adapter capabilities:

- probe runtime health;
- list or validate models/agents when supported;
- start a run from a CrewCmd instruction envelope;
- stream or return assistant output;
- report structured errors;
- cancel an in-flight run when possible;
- report usage when available.

Preferred capabilities:

- output deltas;
- tool-call requests;
- structured JSON output;
- file or artifact references;
- resumable run IDs;
- runtime-side session state;
- capability metadata.

Adapter result events should map back into CrewCmd's event log:

- `agent.run.started`;
- `agent.output.delta`;
- `agent.message.created`;
- `agent.tool.requested`;
- `agent.tool.approved`;
- `agent.tool.completed`;
- `agent.run.completed`;
- `agent.run.failed`;
- `agent.run.cancelled`.

## Orchestration policy

The orchestrator should make participation decisions in a clear order:

1. Identify the room, thread, task, or workflow scope.
2. Resolve readable history and context for the actor.
3. Determine candidate agents from explicit membership and assignments.
4. Apply participation mode and mention/trigger rules.
5. Check runtime visibility and scope eligibility.
6. Build the instruction envelope.
7. Enforce budget, rate, and concurrency limits.
8. Start or queue the agent run.
9. Persist all state transitions and publish realtime events.

No runtime should receive context until policy says it may.

## Instruction envelope

CrewCmd should send adapters a normalized envelope rather than raw chat messages.

Suggested envelope:

```json
{
  "runId": "run_123",
  "agent": {
    "id": "agent_neo",
    "callsign": "neo",
    "role": "Product engineer"
  },
  "scope": {
    "type": "channel",
    "id": "channel_crew",
    "visibility": "team"
  },
  "trigger": {
    "type": "mention",
    "messageId": "msg_123",
    "actorId": "user_123"
  },
  "instructions": {
    "system": "...",
    "policy": "...",
    "task": "..."
  },
  "context": {
    "messages": [],
    "files": [],
    "memory": []
  },
  "tools": [],
  "controls": {
    "stream": true,
    "maxOutputTokens": 2000,
    "timeoutMs": 120000,
    "requiresApprovalForTools": true
  }
}
```

Adapters can translate this into their native shape.

## Governance and privacy

Hard rules:

- private runtimes cannot be attached to team-visible rooms unless explicitly shared;
- agent membership is explicit;
- room history is not sent to an agent unless the agent can read the room;
- tools are granted by policy, not by model request alone;
- tool calls that cross trust boundaries require approval;
- promoted artifacts preserve source provenance;
- generated output records the backing runtime and model/service when available.

This is what allows open-ended agent integration without turning every connected endpoint into an unbounded data sink.

## Realtime and recovery

The collaboration layer depends on durable realtime behavior.

Baseline:

- persist every human message, agent message, run event, and tool event;
- publish events to clients over SSE or WebSocket;
- include cursor IDs so clients can recover missed events;
- let mobile, desktop, and web subscribe to the same event stream;
- keep room scope in every event so DMs and channels do not bleed together;
- let clients refetch by cursor after reconnect.

Single-instance self-hosting can use the database plus in-process fanout. Multi-instance deployments can add Postgres `LISTEN/NOTIFY`, Redis, NATS, or managed SaaS fanout later.

## Open agent ecosystem direction

CrewCmd should be ready for multiple open integration surfaces:

- OpenAI-compatible chat and responses APIs;
- MCP tools and resource servers;
- OpenClaw gateway sessions;
- Hermes execution workers;
- custom HTTP agent endpoints;
- future open agent specs that advertise identity, capabilities, tools, and lifecycle.

The adapter boundary should allow new protocols without changing room UX.

Potential future manifest:

```json
{
  "type": "agent_service",
  "name": "Example Agent Runtime",
  "baseUrl": "https://agent.example.com",
  "capabilities": {
    "streaming": true,
    "tools": true,
    "files": true,
    "cancel": true,
    "sessions": true
  },
  "auth": {
    "methods": ["bearer", "none-local"]
  }
}
```

## Data model checklist

Likely primitives:

- `agents`
  - CrewCmd identity, ownership, visibility, role, avatar, default participation mode.
- `agent_runtime_bindings`
  - agent to runtime/model/service binding with status and capabilities.
- `runtimes`
  - OpenClaw, Hermes, OpenAI-compatible, custom HTTP, CrewCmd worker.
- `runtime_capabilities`
  - discovered or configured capability metadata.
- `rooms`
  - channels, DMs, project rooms, threads, task discussions.
- `room_members`
  - users and agents with roles and participation modes.
- `agent_runs`
  - run lifecycle, trigger, adapter, runtime, status, timing, budget, usage.
- `agent_run_events`
  - durable stream of deltas, tool requests, approvals, failures, cancellations.
- `tool_grants`
  - which agents can use which tools in which scopes.
- `approval_requests`
  - human-in-the-loop decisions.
- `audit_events`
  - policy decisions, promotions, tool calls, runtime changes.

These may map to existing CrewCmd tables rather than requiring all-new names. The contract matters more than exact table names.

## API checklist

Suggested API surfaces:

- `GET /api/agents`
- `POST /api/agents`
- `PATCH /api/agents/:id`
- `POST /api/agents/:id/bind-runtime`
- `GET /api/runtimes`
- `POST /api/runtimes`
- `POST /api/runtimes/:id/probe`
- `GET /api/rooms`
- `POST /api/rooms/:id/members`
- `PATCH /api/rooms/:id/members/:memberId`
- `POST /api/rooms/:id/messages`
- `POST /api/agent-runs`
- `POST /api/agent-runs/:id/cancel`
- `POST /api/agent-runs/:id/retry`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`
- `GET /api/events?cursor=...`

## Implementation phases

### Phase 1: Foundation

- Durable event log for messages and agent run state.
- Realtime client stream with cursor recovery.
- Explicit room membership for humans and agents.
- Participation modes with `mention_only` default.
- Basic agent run lifecycle.

### Phase 2: Universal model-backed agents

- OpenAI-compatible runtime adapter.
- Agent facade over model endpoints.
- Runtime probing and model profiles.
- Streaming output into room timelines.
- Cancellation, retries, and failure visibility.

### Phase 3: Native runtime adapters

- OpenClaw adapter as a first-class runtime.
- Hermes adapter as a first-class runtime.
- Runtime capability discovery.
- Session and job lifecycle mapping.

### Phase 4: Tools and approvals

- Tool grants by room/task scope.
- Human approval flow.
- MCP tool server integration.
- Audit trail for every tool call.
- Artifact promotion from private to shared scopes.

### Phase 5: Open agent service protocol

- Document CrewCmd's preferred HTTP agent adapter contract.
- Support custom company-owned agent services.
- Support manifest-driven capability discovery.
- Add conformance tests for third-party agent services.

### Phase 6: SaaS-scale infrastructure

- External queue for distributed orchestration.
- Redis/NATS/Postgres notification fanout.
- Multi-instance workers.
- Runtime pools and managed provider routing.
- Organization-wide observability, budgets, and billing.

## Open questions

- Should CrewCmd define its own simple open agent service contract, or only adapt existing protocols until a stronger external standard emerges?
- Should agent services be allowed to own session state, or should CrewCmd always own canonical conversation state?
- What is the minimum manifest required for safe third-party agent discovery?
- How should users distinguish "agent can read" from "agent may respond" in the UI?
- Which runtimes should support live voice rooms in the first version?
- Should proactive agents require room-level opt-in plus per-agent opt-in?
- How much of the orchestrator should be exposed as a plugin API?

## Recommended first slice

Start with the durable collaboration substrate:

1. event log and realtime cursor recovery;
2. room-scoped human and agent membership;
3. `mention_only` agent participation;
4. simple agent run table and event stream;
5. OpenAI-compatible adapter as the first universal runtime path.

That slice proves the product thesis: any self-hosted team can plug a local or hosted compatible endpoint into CrewCmd, give it an identity, invite it into a room, and see it behave like a governed teammate instead of a loose chatbot.
