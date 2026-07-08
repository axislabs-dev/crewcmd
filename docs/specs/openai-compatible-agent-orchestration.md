# OpenAI-compatible agent orchestration

Status: draft RFC
Scope: generic OpenAI-compatible endpoints, CrewCmd agent facade, orchestration, and self-hosted deployment
Related: `docs/specs/openclaw-integration.md`, `docs/architecture/runtime-contract-definitions.md`, `docs/plans/orchestration.md`, `docs/plans/quality-reliability-roadmap/phase-2-chat-hardening.md`, `docs/plans/quality-reliability-roadmap/phase-4-model-management.md`

## Purpose

CrewCmd should support OpenClaw and Hermes deeply, but it should not require either one for a user to add an agent to a team.

Many self-hosted AI stacks expose an OpenAI-compatible API:

- local model servers such as Ollama, LM Studio, LocalAI, llama.cpp servers, vLLM, and text-generation-inference bridges;
- hosted model gateways such as OpenRouter, LiteLLM, Together, Fireworks, Groq, Azure OpenAI, or a company-owned proxy;
- custom internal services that implement `/v1/chat/completions` or `/v1/responses`.

Those endpoints are usually **model endpoints**, not full agent runtimes. They can answer a prompt, but they do not automatically provide durable identity, channel membership, task state, tool governance, transcript recovery, runtime privacy, audit logs, or Slack-like behavior.

This spec defines how CrewCmd can turn any compatible endpoint into a governed CrewCmd agent without weakening the richer OpenClaw/Hermes path.

## Product thesis

CrewCmd should be an open-source, self-hostable collaboration layer for humans and agents.

OpenClaw and Hermes remain first-class native runtimes because they can expose richer lifecycle and management semantics. Generic OpenAI-compatible endpoints become a **universal adapter path**: useful immediately, self-hostable, and easy to understand, with CrewCmd providing the missing orchestration around them.

The user-facing outcome:

- "Bring your OpenAI-compatible endpoint."
- "Create an agent identity on top of it."
- "Invite that agent into channels, DMs, and tasks."
- "CrewCmd handles scope, memory policy, tools, retries, audit, and realtime updates."

## Definitions

### Native runtime

A runtime with management semantics beyond model inference.

Examples:

- OpenClaw gateway;
- Hermes execution runtime;
- future CrewCmd-managed worker runtime.

Native runtimes may support agent listing, skill sync, files, tools, session state, jobs, schedules, and runtime-specific operations.

### Compatible model endpoint

An HTTP endpoint that implements enough of an OpenAI-style API for CrewCmd to send model requests.

Minimum target:

- `POST /v1/chat/completions`
- bearer token or no-auth local mode
- one or more selectable models
- non-streaming responses

Preferred target:

- streaming chat completions;
- `/v1/models`;
- tool/function calling;
- JSON response format or structured outputs;
- usage metadata.

Future target:

- `/v1/responses`;
- reasoning/event streams;
- MCP or tool-call transport advertised through metadata.

### CrewCmd agent facade

The CrewCmd-owned agent identity and behavior wrapper around a runtime or model endpoint.

For generic OpenAI-compatible endpoints, the endpoint does not own the agent. CrewCmd owns:

- callsign, display name, avatar, role, and visibility;
- system prompt and instruction stack;
- channel/DM membership;
- participation mode;
- model profile and runtime binding;
- tool and skill permission policy;
- memory/context retrieval policy;
- task and run state;
- audit and provenance.

The endpoint owns only model inference.

### Orchestrator

The CrewCmd service layer that converts a human/channel/task event into a controlled agent run.

Responsibilities:

- resolve conversation scope and permissions;
- resolve agent facade and runtime binding;
- build context and instructions;
- call the runtime adapter;
- execute approved tool calls if supported;
- persist messages, run state, usage, and audit;
- publish realtime events to web, desktop, and mobile clients;
- recover or retry after transport failures.

## Non-goals

This first design does not require CrewCmd to:

- run arbitrary untrusted code from model endpoints;
- expose personal runtimes to shared channels;
- implement a full distributed workflow engine before basic agent chat works;
- require Redis, NATS, hosted realtime, or a managed queue for single-instance self-hosting;
- make generic endpoints equivalent to OpenClaw/Hermes on day one;
- infer tool safety from a model provider's advertised function schema.

## Runtime classes

CrewCmd should support three runtime classes.

| Runtime class | Examples | CrewCmd contract |
| --- | --- | --- |
| `native_agent_runtime` | OpenClaw, Hermes | Runtime owns or exposes agent/session/job semantics; CrewCmd syncs and governs. |
| `compatible_model_endpoint` | Ollama, LM Studio, vLLM, OpenRouter, LiteLLM | Endpoint provides inference; CrewCmd owns the agent facade and orchestration. |
| `crewcmd_worker` | Future built-in worker | CrewCmd owns execution loop and may call model/tool providers internally. |

The rest of this spec focuses on `compatible_model_endpoint`.

## Core decision

An OpenAI-compatible endpoint should not be treated as an agent by itself.

CrewCmd should model it as:

```text
Runtime endpoint
  -> model profile
    -> CrewCmd agent facade
      -> channel/DM/task membership
        -> orchestrated agent runs
```

This avoids the common failure mode where every model connection becomes a global bot with unclear permissions. It also lets one endpoint power many agents with different roles, prompts, tools, scopes, and budgets.

## Self-hosted default architecture

The default self-hosted path should work in one CrewCmd server process plus the configured database.

```text
Client sends message
  -> CrewCmd API persists human message
  -> CrewCmd event log emits message.created
  -> Orchestrator claims eligible agent work
  -> Runtime adapter calls compatible endpoint
  -> Orchestrator persists assistant deltas/result/tool events
  -> Realtime stream pushes updates to all connected clients
```

Single-instance defaults:

- database-backed run state and event log;
- in-process worker loop for pending runs;
- SSE for realtime client updates;
- bounded concurrency per runtime;
- resumable clients using event cursors;
- no required external queue.

Scale-out optional later:

- Postgres `LISTEN/NOTIFY` or Redis pub/sub for fanout;
- Redis, NATS, or a durable queue for distributed workers;
- SaaS-managed runtime pools and provider routing.

## Data model

The current `company_runtimes` model can be extended without creating a parallel provider system.

### Runtime endpoint

Required fields:

- `id`
- `ownerType`: `user | company`
- `ownerUserId`
- `ownerCompanyId`
- `runtimeType`: `openai_compatible`
- `name`
- `baseUrl`
- encrypted credential reference
- `status`
- `metadata`
- `capabilities`

Suggested `metadata`:

```json
{
  "apiShape": "chat_completions",
  "modelsEndpoint": true,
  "streaming": true,
  "toolCalling": "openai-tools",
  "jsonMode": true,
  "responsesApi": false,
  "providerLabel": "Ollama",
  "selfHosted": true
}
```

### Model profile

Model profiles should remain separate from agent identity.

Fields:

- runtime ID;
- provider model ID;
- display name;
- context window;
- max output tokens;
- cost metadata when known;
- default temperature/top-p/reasoning settings;
- capability flags such as streaming, tool calling, vision, JSON mode.

### Agent facade

For compatible endpoints, `agents.runtimeId` points to the endpoint and `agents.runtimeRef` may be null or a CrewCmd-generated facade key.

Agent fields should include or reference:

- prompt/instructions;
- selected model profile;
- visibility and owner fields;
- channel membership;
- allowed tools/skills;
- context policy;
- participation mode;
- budget/concurrency policy.

### Agent run

Every model invocation should become an agent run record.

Minimum fields:

- `id`
- `agentId`
- `runtimeId`
- `modelProfileId`
- `scopeType`
- `scopeId`
- `triggerMessageId`
- `status`: `queued | running | waiting_for_tool | completed | failed | cancelled`
- `inputCursor` / `eventCursor`
- timing fields;
- usage fields;
- error category and safe error message.

The run record gives UI, mobile, tasks, voice, and future schedules a shared lifecycle object.

## Orchestration flow

### 1. Trigger

A run may be triggered by:

- direct message to an agent;
- mention in a channel;
- channel participation mode such as `on_call`;
- task assignment;
- schedule/heartbeat;
- Hermes/OpenFloor event routed into a channel;
- API request.

The trigger must resolve a durable scope before any runtime call.

### 2. Policy gate

Before creating a run, CrewCmd checks:

- user can post/read in the conversation;
- agent is visible/invokable in that scope;
- agent participation mode allows this trigger;
- agent runtime is allowed for the scope;
- personal runtime is not used for shared work;
- selected skills/tools are allowed for that agent and scope;
- budget and concurrency limits permit the run.

### 3. Context build

The orchestrator builds a provider-neutral `AgentRunInput`:

```ts
type AgentRunInput = {
  runId: string;
  agentId: string;
  scope: { type: "private" | "dm" | "channel" | "task" | "schedule"; id: string };
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  tools: ToolDescriptor[];
  responsePolicy: {
    stream: boolean;
    maxOutputTokens?: number;
    jsonMode?: boolean;
  };
};
```

Context sources:

- agent system prompt;
- channel instructions and pinned context;
- visible conversation history;
- task brief;
- selected memory/retrieval snippets;
- skill instructions;
- runtime adapter instructions.

Private context must never be included in shared runs unless explicitly promoted and auditable.

### 4. Adapter call

The OpenAI-compatible adapter maps `AgentRunInput` to provider requests.

Initial mapping:

- system/developer instructions become system messages where supported;
- visible conversation history becomes chat messages;
- tool descriptors become OpenAI `tools` where supported;
- streaming responses become normalized CrewCmd run events;
- non-streaming responses become one final assistant message event.

Adapters must handle provider differences:

- base URL path quirks;
- missing `/v1/models`;
- streaming chunk format differences;
- tool call shape differences;
- missing usage metadata;
- local endpoints with no auth;
- models that ignore system prompts or JSON mode.

### 5. Tool loop

Tool use is owned by CrewCmd, not by the model endpoint.

For a compatible endpoint:

1. model requests a tool call;
2. CrewCmd validates the tool against agent/scope policy;
3. CrewCmd executes the tool through a registered tool runner;
4. CrewCmd persists the tool event and result;
5. CrewCmd resumes the model call with tool output;
6. the loop stops at final answer, limit, error, or cancellation.

This keeps self-hosted model endpoints from becoming arbitrary tool execution authorities.

### 6. Persistence and realtime

The orchestrator persists:

- run status transitions;
- assistant deltas or final assistant message;
- tool calls and tool results;
- usage/cost when known;
- audit events for shared scopes;
- failure and retry details.

Realtime clients receive normalized events:

- `agent.run.queued`
- `agent.run.started`
- `agent.run.delta`
- `agent.run.tool_call`
- `agent.run.tool_result`
- `message.created`
- `agent.run.completed`
- `agent.run.failed`

These events should use the same self-hosted realtime foundation as chat sync.

## Capability discovery

Connection setup should probe the endpoint and produce a clear capability report.

Probe steps:

1. normalize base URL;
2. test auth with a minimal request;
3. call `/v1/models` when available;
4. perform a tiny non-streaming chat completion;
5. perform a tiny streaming completion if enabled;
6. optionally test tool calling and JSON mode;
7. store capabilities and safe diagnostic messages.

The UI should avoid over-promising. For example:

- "Streaming supported"
- "Tool calling not detected"
- "Models endpoint unavailable; enter model ID manually"
- "Local endpoint reachable from server"

## UI model

Runtime setup should distinguish native runtimes from compatible endpoints.

Suggested setup options:

- Connect OpenClaw / Hermes runtime
- Connect OpenAI-compatible endpoint
- Use hosted model provider
- Configure later

For compatible endpoints:

1. enter base URL and credential;
2. probe;
3. choose or enter model IDs;
4. create one or more CrewCmd agent facades;
5. choose owner scope: personal or company;
6. invite agents into DMs/channels/tasks according to policy.

The agent detail surface should show:

- "Powered by: OpenAI-compatible endpoint"
- runtime name;
- selected model profile;
- capability badges;
- tool/memory policy;
- scope and visibility;
- last health check;
- recent runs.

## Voice and live agent mode

Voice mode should route through the same orchestrator.

Long-form voice transcription creates a normal user message in a resolved scope. Then the same trigger/policy/run flow applies.

Live agent mode should not bypass the facade:

- if the agent is native OpenClaw/Hermes, live mode may use native streaming/session features;
- if the agent is a compatible endpoint, CrewCmd provides the live loop through repeated orchestrated turns;
- scope, tool policy, cancellation, and transcript persistence remain CrewCmd-owned.

This lets CrewCmd support basic live behavior for plain endpoints while preserving richer native-runtime integrations when available.

## Hermes and OpenClaw relationship

This spec should not flatten Hermes/OpenClaw into "just OpenAI endpoints."

OpenClaw/Hermes can expose OpenAI-compatible inference, but CrewCmd should prefer their native control surfaces when available:

- agent discovery;
- skill sync;
- schedule/job status;
- files and identity documents;
- session introspection;
- subagent delegation;
- runtime-specific health and diagnostics.

The universal compatible endpoint path is the fallback and expansion path. Native runtimes remain higher fidelity.

## Security and governance

Required invariants:

- credentials are stored server-side and encrypted where supported;
- browser clients never receive runtime credentials;
- personal runtimes cannot power shared scopes;
- shared runtime invocation is auditable;
- tool calls are policy-checked before execution;
- model-provided tool arguments are untrusted input;
- endpoint diagnostics redact secrets, headers, prompts, and private context;
- shared channel agents cannot access private DMs or personal memory by default.

Provider-specific risk:

- local endpoints may be on private networks, so server-side probe errors must be safe and clear;
- hosted compatible endpoints may store prompts, so UI should allow admins to mark data handling notes;
- custom endpoints may claim tool support but behave inconsistently, so tool capability must be tested or disabled by default.

## Failure handling

The orchestrator should classify failures so UI and logs are useful.

Categories:

- `runtime_unreachable`
- `auth_failed`
- `model_not_found`
- `capability_missing`
- `rate_limited`
- `context_too_large`
- `tool_denied`
- `tool_failed`
- `provider_error`
- `cancelled`
- `timeout`

Recovery behavior:

- retry transient network failures with bounded backoff;
- never duplicate final assistant messages after retry;
- allow users to retry a failed run from the same trigger;
- preserve partial stream output as partial, not completed;
- mark failed shared runs visibly in the channel/thread.

## Implementation phases

### Phase 1: Endpoint connection and model profiles

- Add `openai_compatible` runtime type.
- Store base URL, credentials, and capability metadata.
- Probe endpoint and list/enter models.
- Create model profiles.
- Add docs and admin UI copy.

Acceptance:

- A self-hosted user can connect Ollama/LM Studio/LocalAI or a hosted compatible gateway.
- CrewCmd can validate basic chat completion without creating a channel agent yet.

### Phase 2: Agent facade for chat and DMs

- Create CrewCmd-owned agents backed by compatible endpoints.
- Route private agent DMs through the orchestrator.
- Persist agent runs and assistant messages.
- Support streaming where available.
- Enforce personal/shared runtime boundaries.

Acceptance:

- A personal compatible-endpoint agent can answer in a private DM.
- A company compatible-endpoint agent can answer when mentioned in a shared channel.
- A personal endpoint cannot be attached to a shared channel.

### Phase 3: Tool loop and skills

- Map approved CrewCmd tools/skills into provider tool descriptors.
- Execute tool calls through CrewCmd policy.
- Persist tool events and resume model calls.
- Add limits for iterations, runtime, and output size.

Acceptance:

- A compatible endpoint can use a simple approved tool in a private DM.
- A denied tool call is visible and audited.
- Shared scopes only expose shared-approved tools.

### Phase 4: Task, schedule, and live mode integration

- Trigger compatible-endpoint agents from tasks and schedules.
- Route long-form voice and live agent turns through the same run model.
- Add cancellation and progress events.
- Integrate with the self-hosted realtime stream.

Acceptance:

- Assigning a task to a compatible-endpoint agent creates visible run progress and a completion/failure result.
- Voice-created messages can trigger the agent without transcript truncation or cross-scope leakage.

### Phase 5: Optional scale-out adapters

- Add distributed worker support.
- Add Redis/NATS/Postgres notification fanout.
- Add provider routing and SaaS policy hooks.
- Add per-provider cost analytics.

Acceptance:

- Single-instance self-hosting remains the default.
- Multi-instance deployments can turn on external infrastructure without changing the user model.

## Open questions

- Should CrewCmd support `/v1/responses` first for newer providers, or keep `/v1/chat/completions` as the baseline until adapters are mature?
- Should model profiles live in a dedicated table before this work, or can they begin as runtime metadata plus agent config?
- Should compatible endpoints support MCP tools directly, or should MCP always be mediated by CrewCmd's tool policy?
- How much provider-specific preset logic should CrewCmd ship for Ollama, LM Studio, LiteLLM, OpenRouter, and Azure OpenAI?
- Should a compatible endpoint be allowed to advertise agent-like identities, or should CrewCmd always own the facade for this class?

## One-line invariant

OpenAI-compatible endpoints provide inference; CrewCmd provides the agent, orchestration, scope, tools, memory, audit, and Slack-like collaboration contract.
