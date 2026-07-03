# Design: Hermes Agent Runtime Integration

- **Author:** Codex
- **Status:** Draft
- **Created:** 2026-07-04
- **Target:** Runtime provider expansion after OpenClaw v1

## Problem Statement

CrewCmd currently treats OpenClaw as its first runtime integration. The data model is already mostly runtime-agnostic, but the implementation path for probing, importing, model discovery, skill sync, and runtime provisioning is still OpenClaw-shaped.

Hermes Agent should be supported as an additional runtime without weakening the existing OpenClaw integration, runtime privacy rules, or shared-agent governance model.

The practical integration question is not "Can CrewCmd call Hermes?" The answer is yes: Hermes exposes an OpenAI-compatible API server. The harder question is how much of CrewCmd's runtime management plane should become provider-neutral before Hermes is added.

## Current State

CrewCmd already has the right high-level nouns:

- `company_runtimes.runtime_type` is free text and defaults to `openclaw`.
- `agents.adapter_type` is free text and defaults to `openclaw_gateway`.
- agents link to runtimes with `runtime_id` and `runtime_ref`.
- runtime ownership already distinguishes personal and company-owned runtimes.

The current implementation is still OpenClaw-specific in key paths:

- `src/app/api/runtimes/probe/route.ts` only understands OpenClaw gateway, local config, and paste modes.
- `src/app/api/runtimes/import/route.ts` imports `DiscoveredAgent` records from the OpenClaw gateway shape and hardcodes `adapterType: "openclaw_gateway"`.
- `src/lib/push-skill-to-runtime.ts`, `src/lib/runtime-agent-model-sync.ts`, and related helpers call OpenClaw `GatewayClient` methods directly.
- `src/app/onboarding/page.tsx` creates an OpenClaw runtime with `runtimeType: "openclaw"`.
- `src/lib/adapters/openclaw-gateway.ts` is very close to an OpenAI Chat Completions adapter, but its naming, prompts, and error messages are OpenClaw-specific.

## Hermes Runtime Surface

Hermes exposes several integration surfaces. They should not all be adopted in the first slice.

### HTTP API Server

Hermes can expose an OpenAI-compatible HTTP API server:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- bearer auth via `API_SERVER_KEY`
- default port `8642`

This is the best MVP integration path because it maps directly to CrewCmd's existing one-shot task adapter model.

Important operational detail: Hermes API requests execute with the Hermes API server's configured tools and terminal backend. If Hermes is running on a remote VPS, filesystem and shell tools run on that VPS, not on the user's laptop.

### ACP and TUI JSON-RPC

Hermes also supports richer programmatic control through ACP and TUI gateway JSON-RPC. Those paths expose sessions, streaming chunks, tool-call events, permission requests, cancellation, forks, and more lifecycle detail.

Those surfaces are better suited for a later native integration. They should not block an HTTP MVP.

### Dashboard and Messaging Gateways

Hermes desktop, dashboard, Telegram, Discord, Slack, WhatsApp, Signal, email, and other messaging integrations are outside CrewCmd's MVP scope. CrewCmd should integrate with the runtime API, not try to manage every Hermes user surface.

## Goals

1. Add Hermes as a first-class runtime type alongside OpenClaw.
2. Keep personal-runtime and shared-runtime isolation unchanged.
3. Support a useful MVP through Hermes' HTTP API server.
4. Avoid pretending Hermes supports OpenClaw-only capabilities.
5. Make unsupported operations explicit in code and UI.
6. Introduce a provider abstraction that keeps future runtimes reviewable.

## Non-Goals

- Do not replace OpenClaw or change OpenClaw behavior.
- Do not install, host, update, or supervise Hermes from CrewCmd in the MVP.
- Do not translate OpenClaw skills into Hermes-native skills in the first slice.
- Do not implement Hermes ACP, TUI JSON-RPC, or native session streaming in the MVP.
- Do not change runtime privacy rules.
- Do not rely on a global primary runtime fallback for chat, voice, or task execution.

## Recommended Approach

Use a staged integration:

1. Introduce a runtime provider contract while preserving existing OpenClaw behavior.
2. Add a Hermes HTTP provider and `hermes_api` execution adapter.
3. Add onboarding/settings UI for connecting a Hermes API server.
4. Mark OpenClaw-only operations as unsupported for Hermes.
5. Add Hermes-native session and event support later only if the HTTP MVP proves useful.

## Runtime Provider Contract

Add a provider registry separate from the existing execution adapter registry.

Suggested location:

- `src/lib/runtimes/providers/types.ts`
- `src/lib/runtimes/providers/index.ts`
- `src/lib/runtimes/providers/openclaw.ts`
- `src/lib/runtimes/providers/hermes.ts`

Draft shape:

```ts
export type RuntimeType = "openclaw" | "hermes" | "custom";

export interface RuntimeProvider {
  readonly type: RuntimeType;
  readonly displayName: string;

  probe(input: RuntimeProbeInput): Promise<RuntimeProbeResult>;
  normalizeImport(input: RuntimeImportInput): RuntimeImportPlan;
  buildAgentAdapterConfig(input: RuntimeAgentConfigInput): RuntimeAgentConfig;
  discoverModels(runtimeId: string): Promise<RuntimeDiscoveredModel[]>;

  syncAgentModel?(input: RuntimeModelSyncInput): Promise<void>;
  syncSkillAssignment?(input: RuntimeSkillSyncInput): Promise<RuntimeSyncResult>;
  provisionOperatingLayer?(runtimeId: string): Promise<RuntimeSyncResult>;
}
```

Provider responsibilities:

- normalize provider-specific probe responses into CrewCmd's common import shape;
- decide the correct `adapterType` and `adapterConfig`;
- expose capability flags for UI and route guards;
- provide no-op or explicit "unsupported" responses for provider-specific management operations.

## Hermes MVP Behavior

### Runtime Registration

For the first slice, a Hermes runtime is a Hermes API server profile.

User-provided fields:

- display name;
- API base URL, default `http://localhost:8642`;
- API key matching `API_SERVER_KEY`;
- owner type, inherited from the selected workspace flow.

Normalize URLs defensively:

- accept `http://localhost:8642`;
- accept `http://localhost:8642/v1`;
- store the root API URL in `httpUrl`;
- store the same value in `gatewayUrl` until the schema has a provider-neutral `managementUrl` field;
- store the normalized `/v1` base in `metadata.apiBaseUrl`.

No migration is required for the MVP because `runtimeType`, `gatewayUrl`, `httpUrl`, and `metadata` can hold this data. A later cleanup can rename `gatewayUrl` to `managementUrl` or split management and execution endpoints explicitly.

### Probe

`POST /api/runtimes/probe` should accept `runtimeType: "hermes"`.

Hermes probe sequence:

1. Normalize the API URL.
2. Call `GET /health`.
3. Call `GET /v1/models` with `Authorization: Bearer <token>`.
4. Return a normalized probe result with one importable agent representing the Hermes profile.

The default imported agent can use:

- `id`: model id from `/v1/models`, usually `hermes-agent` or profile name;
- `name`: user-provided runtime name or model id;
- `title`: `Hermes Agent`;
- `emoji`: default agent emoji;
- `model`: selected Hermes model id;
- `description`: "Hermes API server profile connected through CrewCmd."

If `/health` succeeds but `/v1/models` returns `401`, the probe should report an auth failure. If `/health` fails, report connectivity or server-not-enabled guidance.

### Import

`POST /api/runtimes/import` should dispatch by `runtime.runtimeType`.

For Hermes:

- set `adapterType: "hermes_api"`;
- set `runtimeRef` to the Hermes model/profile id;
- set `adapterConfig.url` to the normalized root API URL;
- set `adapterConfig.headers.Authorization` from `runtime.authToken`;
- do not attach OpenClaw mirrored files or OpenClaw-specific operating-layer file metadata;
- do create normal CrewCmd workspace grants and ownership fields.

Hermes API server does not expose an OpenClaw-style multi-agent list through the HTTP MVP. If users run multiple Hermes profiles, CrewCmd should initially represent each profile/API server as a separate runtime registration.

### Execution Adapter

Add a dedicated `hermes_api` adapter instead of reusing the current generic `http` adapter.

Reason:

- `http` posts `{ prompt, context }`, not OpenAI Chat Completions.
- `openclaw_gateway` already posts Chat Completions, but it carries OpenClaw-specific names and messages.

Implementation options:

1. Extract a shared `ChatCompletionsAdapter` and have `openclaw_gateway` and `hermes_api` wrap it with provider-specific system prompts.
2. Copy the small OpenClaw HTTP adapter first, then refactor once Hermes is verified.

The cleaner option is extraction, but the smallest reviewable option is a dedicated `HermesApiAdapter` with tests.

### Model Discovery

`discoverRuntimeModels(runtimeId)` should dispatch through the provider registry.

Hermes implementation:

- call `GET /v1/models`;
- normalize OpenAI-style model objects into `RuntimeDiscoveredModel`;
- provider should be `hermes` unless the response gives a more specific provider.

### Unsupported Operations

These should be explicit for Hermes MVP:

- skill sync to runtime;
- OpenClaw config patching;
- OpenClaw operating layer provisioning;
- runtime heartbeat secret push;
- OpenClaw node/session routes;
- realtime voice passthrough;
- cron sync through OpenClaw gateway.

Routes and helpers should return or log `unsupported_for_runtime_type` rather than attempting OpenClaw GatewayClient calls.

## Capability Matrix

| Capability | OpenClaw today | Hermes HTTP MVP | Hermes native future |
| --- | --- | --- | --- |
| Task execution | Yes | Yes | Yes |
| Model discovery | Yes | Yes | Yes |
| Runtime probe | Yes | Yes | Yes |
| Multi-agent import | Yes | No, one profile per runtime | Maybe, profile-aware |
| Skill sync | Yes | No | Maybe, Hermes-native skills |
| Model writeback | Yes | No | Maybe |
| Config patching | Yes | No | Maybe |
| Tool event streaming | Partial/path-specific | No | Yes via ACP or TUI JSON-RPC |
| Approval flow | OpenClaw-specific | No | Yes via ACP |
| Session fork/cancel | OpenClaw-specific | No | Yes via ACP |
| Cron/schedules | OpenClaw-specific | No | Maybe |
| Realtime voice passthrough | OpenClaw-specific | No | Unknown |

## Security and Trust Model

Hermes API access is high trust. The API server can expose terminal commands, filesystem access, web browsing, memory, and skills configured on the Hermes host.

Requirements:

- Store the Hermes API key in `company_runtimes.authToken`.
- Never return raw runtime tokens to the browser after creation.
- Prefer server-to-server calls from CrewCmd; browser CORS is not needed for CrewCmd's integration path.
- Warn users that remote Hermes tools execute on the Hermes host.
- Keep personal Hermes runtimes private and block them from shared channels.
- Keep shared Hermes runtimes company-owned and auditable.
- Recommend private networking, Tailscale, SSH tunnels, or TLS reverse proxy for remote Hermes API servers.
- Warn against exposing the Hermes API server directly to the public internet.

The existing runtime class invariant still applies:

> Personal runtimes are private execution homes; shared collaboration uses shared runtimes, and channel-level agent mode decides whether any shared agent can listen or respond.

## UX Design

### Connect Runtime

Onboarding and settings should show a provider selector:

- OpenClaw Gateway
- Hermes Agent API

Hermes form fields:

- Runtime name
- API URL
- API key
- Owner type
- Visibility

Default API URL:

```text
http://localhost:8642
```

Probe copy should be precise:

- "CrewCmd will call the Hermes API server from the CrewCmd server."
- "If CrewCmd is hosted remotely, `localhost` means the CrewCmd server, not your laptop."
- "Hermes tool calls run where the Hermes API server runs."

### Preview

The preview should show one importable agent for the connected Hermes profile:

- name;
- model/profile id;
- runtime type badge: `Hermes`;
- capability notes: execution and model discovery supported, runtime skill sync not supported.

### Runtime Details

Runtime detail UI should show provider-specific capabilities:

- execution: supported;
- models: supported;
- skills: unsupported in MVP;
- native sessions: unsupported in MVP;
- management API: HTTP only.

## API Changes

### `POST /api/runtimes/probe`

Add:

```json
{
  "runtimeType": "hermes",
  "url": "http://localhost:8642",
  "token": "..."
}
```

Keep existing OpenClaw `mode` behavior for compatibility.

### `POST /api/runtimes`

No schema change for MVP.

Hermes runtime create payload:

```json
{
  "runtimeType": "hermes",
  "name": "Hermes Agent",
  "gatewayUrl": "http://localhost:8642",
  "httpUrl": "http://localhost:8642",
  "authToken": "...",
  "metadata": {
    "provider": "hermes",
    "apiBaseUrl": "http://localhost:8642/v1"
  }
}
```

### `POST /api/runtimes/import`

Dispatch on runtime type:

- `openclaw`: current behavior;
- `hermes`: Hermes import plan;
- unknown: `400 unsupported_runtime_type`.

## Testing Plan

Smallest useful verification:

- unit test URL normalization for Hermes API URLs;
- unit test Hermes probe success with `/health` and `/v1/models`;
- unit test Hermes probe auth failure;
- unit test import creates `adapterType: "hermes_api"`;
- unit test `hermes_api` posts OpenAI Chat Completions format;
- route test that OpenClaw probe behavior remains unchanged;
- route test that OpenClaw-only skill sync does not run for Hermes.

Manual smoke test:

```sh
curl http://localhost:8642/health
curl -H "Authorization: Bearer $API_SERVER_KEY" http://localhost:8642/v1/models
curl http://localhost:8642/v1/chat/completions \
  -H "Authorization: Bearer $API_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"Say hello from Hermes."}]}'
```

CrewCmd smoke test:

1. Connect Hermes runtime from onboarding/settings.
2. Probe succeeds and shows one profile agent.
3. Import creates a CrewCmd agent.
4. Start the agent.
5. Dispatch a task.
6. Confirm output is returned and appears in the agent output buffer.
7. Confirm shared/private runtime policy still blocks personal runtime use in shared scopes.

## Implementation Slices

### PR 1: Runtime provider dispatch skeleton

Goal: introduce provider dispatch without changing behavior.

Likely files:

- `src/lib/runtimes/providers/types.ts`
- `src/lib/runtimes/providers/index.ts`
- `src/lib/runtimes/providers/openclaw.ts`

Verification:

- existing runtime route tests;
- targeted provider registry tests.

### PR 2: Hermes HTTP adapter and probe

Goal: connect and verify Hermes API server.

Likely files:

- `src/lib/adapters/hermes-api.ts`
- `src/lib/runtimes/providers/hermes.ts`
- `src/app/api/runtimes/probe/route.ts`

Verification:

- adapter unit tests;
- Hermes probe route tests;
- `git diff --check`.

### PR 3: Hermes import and model discovery

Goal: import one Hermes profile agent and list models.

Likely files:

- `src/app/api/runtimes/import/route.ts`
- `src/lib/runtime-model-discovery.ts`
- `src/lib/runtimes/providers/hermes.ts`

Verification:

- import route tests;
- model discovery tests.

### PR 4: UI and unsupported-operation guards

Goal: make Hermes discoverable in product and prevent OpenClaw-only calls.

Likely files:

- `src/app/onboarding/page.tsx`
- runtime/settings UI file once selected;
- OpenClaw-only sync helpers or guard wrapper.

Verification:

- targeted component/API tests where available;
- manual onboarding smoke test.

## Open Questions

1. Should a Hermes profile be modeled as one CrewCmd runtime or should one Hermes process with multiple profiles map to many CrewCmd runtimes?
2. Should the MVP use a generic `openai_compatible_agent` adapter or a Hermes-branded `hermes_api` adapter?
3. Should CrewCmd eventually write Hermes-native skills, or should Hermes manage its own skills independently?
4. Should Hermes ACP be the v2 native path, or is TUI JSON-RPC a better fit for CrewCmd's shared channel and task model?
5. What live status should CrewCmd show for Hermes before native sessions are available?

## Recommended Decision

Ship Hermes in two layers:

1. **MVP:** Hermes API server as a first-class runtime with execution and model discovery.
2. **Native integration:** ACP or TUI JSON-RPC only after the MVP is validated.

This gives CrewCmd immediate coverage for users already running Hermes while keeping OpenClaw's richer management integration intact and reviewable.

## References

- CrewCmd runtime contract: `docs/architecture/runtime-contract-definitions.md`
- CrewCmd OpenClaw integration spec: `docs/specs/openclaw-integration.md`
- OpenClaw skill sync design: `docs/design/crewcmd-openclaw-skill-sync.md`
- Hermes API server: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- Hermes Open WebUI integration: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/open-webui
- Hermes programmatic integration: https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration
- Hermes Docker gateway notes: https://hermes-agent.nousresearch.com/docs/user-guide/docker
