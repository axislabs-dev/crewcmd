# Runtime Routing Audit

Date: 2026-04-28

CrewCMD supports BYO runtimes: a user can connect personal runtimes while also working in company/team workspaces. Runtime routing should therefore avoid any process-wide "primary runtime" unless the workflow is explicitly a workspace default, onboarding, or runtime management action.

## Classification Key

- Valid onboarding/default fallback: acceptable only for setup, discovery, or selecting a default runtime for a workspace.
- Must route by selected agent runtime: user selected an agent; gateway calls must use that agent's `runtimeId` and `runtimeRef`.
- Must route by selected workspace runtime: user selected a workspace-level automation or deployment target; gateway calls must use the runtime selected for that workspace.
- Must route by explicit `runtimeId`: API/function already receives a runtime id or runtime record; keep this explicit.
- Unsafe/ambiguous: current code can cross personal/company runtime boundaries or use a global default when multiple runtimes exist.

## Inventory

| Area | Runtime source today | Classification | Notes |
| --- | --- | --- | --- |
| `src/lib/gateway-chat-pool.ts#getGatewayClient` | First `companyRuntimes.isPrimary = true` across the whole DB | Unsafe/ambiguous | Pool key is runtime id, but lookup is global. This can select another user's or another company's primary runtime. |
| `src/app/api/chat/route.ts` | `getGatewayClient()`, body/cookie `companyId`, optional `targetAgent.runtimeRef` only in prompt | Must route by selected agent runtime | The selected CrewCMD agent should resolve to its DB row, then connect to `agent.runtimeId` and send to `agent.runtimeRef`. Current delegation prompt can talk to the wrong gateway. |
| `src/app/api/chat/history/route.ts` | `getGatewayClient()` with `sessionKey` | Must route by selected agent runtime or explicit runtimeId | Needs `runtimeId`/agent context because session keys are gateway-local. |
| `src/app/api/openclaw/sessions/route.ts` | `getGatewayClient()` despite comment mentioning `runtimeId` | Must route by explicit `runtimeId` | API should require or honor `runtimeId`; current implementation ignores it. Gateway session rows also lack runtime scoping. |
| `src/app/api/openclaw/sessions/[key]/preview/route.ts` | `getGatewayClient()` | Must route by explicit `runtimeId` | Preview keys are gateway-local; route must not use process-global primary runtime. |
| `src/lib/gateway-event-bridge.ts` | Singleton bridge over `getGatewayClient()` | Unsafe/ambiguous | Needs one bridge per runtime or a scoped bridge keyed by runtime id; persisted `gatewaySessions` need runtime identity. |
| `src/app/api/openclaw/bridge/status/route.ts` | Starts singleton event bridge | Unsafe/ambiguous | Status should be scoped by runtime or workspace. |
| `src/lib/gateway-client.ts` | Constructor `gatewayUrl`; no ownership lookup | Must route by explicit `runtimeId` | Low-level transport is fine. Callers are responsible for selecting the correct runtime before constructing the client. |
| `src/lib/runtime-cron-sync.ts#resolvePrimaryReadableRuntimeForActiveWorkspace` | Active workspace/company, then primary/fallback runtime within that scope | Must route by selected workspace runtime | Better than global primary. Still default/fallback oriented; acceptable for the automations page only if UI is scoped to active workspace and shows runtime. |
| `src/lib/runtime-cron-sync.ts#listCronJobsFromRuntime` | Runtime from active workspace helper | Must route by selected workspace runtime | Used by automation listing/runs/schedule patching. Needs explicit runtime follow-up if UI supports choosing a runtime. |
| `src/app/api/automations/runs/route.ts` | Runtime returned by `listCronJobsFromRuntime()` | Must route by selected workspace runtime | Job IDs are runtime-local; should include runtime id for precision. |
| `src/app/api/schedules/[id]/route.ts` | Runtime returned by `listCronJobsFromRuntime()` | Must route by selected workspace runtime | Patching a schedule by id without runtime id is ambiguous when multiple runtimes expose the same job id. |
| `src/app/api/runtimes/route.ts` | Lists readable runtimes; creates runtime from selected workspace | Valid onboarding/default fallback | Creation sets `isPrimary` only within same owner/storage query. Personal runtimes still require an anchor company for skill storage. |
| `src/app/api/runtimes/[id]/route.ts` | Path `id` | Must route by explicit `runtimeId` | Runtime read/delete are explicit and ownership-checked. Replacement primary is scoped to same owner tuple. |
| `src/app/api/runtimes/probe/route.ts` | Provided URL/token or local config | Valid onboarding/default fallback | Discovery path; not tied to existing runtime ownership until create/import. |
| `src/lib/openclaw-config-parser.ts` | Local OpenClaw config file, derives `gatewayUrl` | Valid onboarding/default fallback | Same-machine discovery only; not used for routing an existing CrewCMD runtime. |
| `src/app/api/runtimes/import/route.ts` | Body `runtimeId` | Must route by explicit `runtimeId` | Good explicit routing and ownership checks. Calls `pushSkillToRuntime(runtimeId)` and `ensureCrewCmdRuntimeOperatingLayer(runtimeId)`. |
| `src/lib/push-skill-to-runtime.ts` | Function `runtimeId` | Must route by explicit `runtimeId` | Good explicit gateway connection. Uses runtime owner scope to resolve workspace and storage company. |
| `src/lib/runtime-operating-layer.ts` | Function `runtimeId` | Must route by explicit `runtimeId` | Good explicit gateway connection. Cleanup calls uninstall by agent/skill later; see uninstall note. |
| `src/lib/sync-skill-to-openclaw.ts` | Agent row `runtimeId` | Must route by selected agent runtime | Good agent-based runtime routing. Scope checks are on skill load, not runtime ownership; call sites must pass correct workspace/company. |
| `src/lib/push-secrets-to-gateway.ts` | Agent row `runtimeId` | Must route by selected agent runtime | Good agent-based routing. Secret scope comes from options/skill. |
| `src/lib/uninstall-skill-from-openclaw.ts` | Agent row `runtimeId` | Must route by selected agent runtime | Mostly correct. `companyId` is still required by call sites for assignment/resource cleanup and should be checked when personal runtimes use company skill storage. |
| `src/lib/openclaw-gateway-skill-assignment.ts` | Runtime record parameter | Must route by explicit `runtimeId` | Good explicit runtime record usage. |
| `src/lib/runtime-agent-model-sync.ts` | Function `runtimeId` and `runtimeRef` | Must route by explicit `runtimeId` | Correct explicit model sync target. |
| `src/lib/blueprint-runtime-provisioning.ts` | Runtime record parameter | Must route by selected workspace runtime | Correct once caller selects the right workspace runtime. |
| `src/app/api/blueprints/deploy/route.ts` | Primary runtime for selected workspace | Must route by selected workspace runtime | Workspace-scoped primary is acceptable as a deployment default, but follow-up should allow explicit runtime selection for multiple workspace runtimes. |
| `src/lib/sync-heartbeat-secret-to-runtimes.ts` | All runtimes readable by access context | Valid ownership-scoped broadcast | Intended secret rotation fan-out. Uses `buildRuntimeReadWhere`. |
| `src/lib/runtime-callback-url.ts` and `src/lib/detect-callback-url.ts` | Runtime `gatewayUrl` metadata/callback inference | Valid onboarding/default fallback | URL derivation only; safe when caller already selected the runtime. |
| `src/app/api/agents/route.ts` | GET `workspaceId` plus optional `runtimeId`; POST `runtimeId` ownership helper | Must route by selected workspace/runtime | Listing is workspace-scoped and can filter by runtime. Creation uses runtime ownership to set agent owner. |
| `src/app/api/agents/[callsign]/route.ts` | Agent row `runtimeId` for capabilities/model/skill refresh | Must route by selected agent runtime | Good for model sync and refresh. Ensure `resolveAgent` remains access-aware before expanding this surface. |
| `src/app/api/agents/[callsign]/start|stop|restart` | Local `agent-runtime` process manager | No gateway routing | Not part of OpenClaw gateway routing, but access checks should stay separate. |
| `src/lib/workspace.ts#resolveAccessibleWorkspace` | Explicit workspace/company, heartbeat `x-crewcmd-runtime-id`, active cookies fallback | Valid onboarding/default fallback | Good workspace fallback. Heartbeat bearer allows only runtime owner workspace, but only the default runtime workspace today. |
| `src/lib/workspace.ts#resolveRuntimeWorkspace` | Runtime owner fields | Valid ownership helper | Correct mapping: user runtime to personal workspace, company runtime to company workspace. |
| `src/lib/workspace.ts#listWorkspaceAgents` | Workspace id, optional `runtimeId` | Must route by selected workspace/runtime | Filters detached/runtime-specific agents after workspace grant lookup. |
| `src/lib/agent-access.ts#resolveRuntimeOwnership` | Explicit `runtimeId` | Valid ownership helper | Normalizes legacy `ownerCompanyId` from `companyId`. |
| `src/lib/agent-access.ts#runtimeOwnershipValues` | Requested owner type, user id, active company/workspace company | Valid ownership helper | BYO personal runtime keeps `ownerType=user` and uses company id only as storage anchor. |
| `src/lib/company.ts` and `src/app/api/chat/events/route.ts` | `active_company` cookie fallback | Not runtime routing | Company-scoped helper/SSE feed. Keep separate from gateway routing, but avoid using it as runtime selection input. |
| `src/app/api/skills/*`, `src/app/api/projects`, `src/app/api/inbox`, `src/app/api/service-secrets` | `workspaceId` preferred, `companyId` shorthand | Not gateway routing | Workspace access/scoping is relevant to BYO runtimes but these routes do not open gateway clients directly. |

## Risky Call Sites

1. `getGatewayClient()` is process-global. It must not be used for chat, sessions, previews, or event bridges in BYO runtime mode.
2. Chat routing uses `targetAgent.runtimeRef` only as text inside a delegation prompt. It does not resolve the selected agent's `runtimeId`.
3. Gateway session storage is not runtime-scoped. A session key like `main` can collide across personal and company runtimes.
4. Event bridge is a singleton. It cannot represent multiple personal/team runtimes safely.
5. Automations use active workspace primary/fallback runtime. This is safer than global primary, but runtime-local job IDs still need explicit runtime id when users can operate multiple runtimes in one workspace.
6. Blueprint deployment uses selected workspace primary runtime. This is acceptable as a default, but should become explicit when deploying to non-primary workspace runtimes.

## Recommended PR Sequence

1. Add a runtime-scoped gateway pool API, for example `getGatewayClientForRuntime(runtimeId)` and optionally `getGatewayClientForAgent(agentId)`, while keeping current `getGatewayClient()` only for temporary/default callers.
2. Route `/api/chat`, `/api/chat/history`, `/api/openclaw/sessions`, and `/api/openclaw/sessions/[key]/preview` by selected agent or explicit `runtimeId`; reject ambiguous requests.
3. Add `runtimeId` to gateway session persistence and event bridge state. Run one event bridge per runtime or make refresh explicit per runtime.
4. Update automation read/run/patch routes to accept explicit `runtimeId`; keep active workspace primary as a visible default fallback.
5. Update blueprint deployment UI/API to accept an explicit target runtime and keep workspace primary as a default.
6. Add access tests for runtime-scoped chat/session APIs, covering personal runtime, company runtime, and cross-scope denial.

## No-Change Areas In This Audit PR

- No public CLI command changes.
- No config format changes.
- No gateway routing refactor.
- No schema migration.
- No production data mutation.
- No changes to OpenClaw gateway RPC behavior.

## Tests Added

- `src/lib/agent-access.test.ts` covers runtime ownership helpers for BYO personal runtime ownership, company runtime requirements, legacy company ownership normalization, and company-admin management checks.
