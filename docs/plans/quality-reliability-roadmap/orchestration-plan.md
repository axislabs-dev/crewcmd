# Concurrent Orchestration Plan

This plan turns the roadmap into parallel workstreams with a maximum of five
active agents or branches at a time. Each workstream owns one branch and one PR.
Do not combine several agents' implementation work into one branch unless the
maintainer explicitly asks for a combined PR.

## Operating Rules

- Maximum active implementation workstreams: 5.
- One workstream owns one branch.
- One branch opens one PR.
- One PR contains one reviewable intent.
- Keep each commit to three files or fewer unless the maintainer approves an
  exception before committing.
- Stacked PRs must use the previous PR head as their base.
- Integration PRs should contain only integration glue, conflict resolution,
  documentation that connects parts, or end-to-end verification updates.
- High-risk areas need explicit approval before implementation:
  - schema changes
  - runtime routing behavior
  - config write behavior
  - secure desktop storage
  - package-manager lockfile cleanup

## Human Decisions Before High-Risk Work

1. Approve schema changes for runtime-scoped `gateway_sessions`.
2. Approve schema changes for model discovery and persisted model profiles.
3. Pick desktop shell direction. Recommended default: Electron first.
4. Confirm pnpm-only policy and whether root `package-lock.json` should be
   removed in a dedicated cleanup PR.
5. Confirm that Phase 2 chat transparency should not include runtime routing
   changes; runtime routing belongs in Phase 3.

## Current Coordination Status

Status as of 2026-05-01:

- Wave 1 PRs have merged.
- Wave 2 PRs have merged.
- Wave 3 PRs have merged.
- Wave 4 is the active starting point for newly available workstream slots.
- Runtime routing behavior and runtime-scoped persistence remain high-risk; get
  explicit approval before implementing those changes.

## Wave 1: Merged

These five foundation workstreams have completed and merged.

| Slot | Branch | PR Title | Intent | Risk |
| --- | --- | --- | --- | --- |
| 1 | `codex/ci-lint-hygiene` | `ci: add non-mutating lint and whitespace checks` | Add `lint:check`, CI lint, and `git diff --check`. | Low |
| 2 | `codex/api-response-primitives` | `refactor: add api response primitives` | Add shared API response/error helper and migrate one low-risk route. | Low |
| 3 | `codex/chat-immediate-sse` | `fix: return chat stream before gateway send completes` | Return SSE immediately and run `chat.send` asynchronously. | Medium |
| 4 | `codex/gateway-runtime-scoped-pool` | `fix: add runtime-scoped gateway clients` | Add runtime-scoped gateway client lookup while preserving legacy fallback. | Medium |
| 5 | `codex/desktop-architecture-adr` | `docs: define desktop shell architecture` | Decide Electron/Tauri boundary, server URL model, and release assumptions. | Low |

### Wave 1 Notes

- `chat-immediate-sse` is the critical user-facing reliability fix.
- `gateway-runtime-scoped-pool` is the base for safe multi-runtime routing.
- `desktop-architecture-adr` should stay docs-only and should not add desktop
  dependencies.
- Wave 1 is closed for orchestration; follow-up work should be tracked in the
  dependent Wave 2+ branches.

## Wave 2: Contract and Diagnostics - Merged

These contract and diagnostics workstreams have completed and merged.

| Branch | PR Title | Depends On | Intent | Risk |
| --- | --- | --- | --- | --- |
| `codex/chat-progress-event-contract` | `feat: define structured chat stream events` | `codex/chat-immediate-sse` | Add typed progress events while preserving legacy text deltas. | Medium |
| `codex/gateway-diagnostics-api` | `feat: add gateway diagnostics state` | none | Add redacted gateway diagnostics and failure classification. | Medium |
| `codex/gateway-config-patch-helper` | `feat: validate gateway config patches` | diagnostics helpful | Centralize config patch validation, notes, conflict mapping. | Medium-high |
| `codex/runtime-model-discovery` | `feat: discover runtime models` | runtime client shape helpful | Read-only `models.list` discovery and normalization. | Medium |
| `codex/eslint-next-16` | `chore: align next eslint config` | package policy | Align `eslint-config-next` with Next.js 16. | Low-medium |

### Wave 2 Notes

- Keep runtime model discovery read-only until config writes are hardened.
- Config patch helper must land before agent model override writes.
- If `eslint-config-next` requires dependency lockfile churn, keep it separate
  from `ci-lint-hygiene`.

## Wave 3: Chat Transparency Stack - Merged

These chat transparency workstreams have completed and merged.

| Branch | PR Title | Depends On | Intent | Risk |
| --- | --- | --- | --- | --- |
| `codex/chat-active-history-polling` | `feat: poll chat history during active runs` | immediate SSE, event contract preferred | Surface progress from `chat.history` when live deltas are sparse. | Medium |
| `codex/chat-active-run-store` | `feat: track active chat run state` | event contract | Track run/session/tool state and ignore stale events. | Medium |
| `codex/chat-execution-progress-ui` | `feat: show chat execution progress` | active run store | Show thinking/tool/subagent/done/error state in chat. | Medium |
| `codex/chat-hardening-smoke-tests` | `test: cover chat hardening smoke flows` | progress UI | Add long-running, cancel, and session-switch coverage. | Medium |

### Wave 3 Notes

- Do not mix UI work into the immediate SSE PR.
- Do not mix runtime-scoped gateway routing into Phase 2 chat PRs.
- Preserve OpenAI-compatible text delta frames until the UI migration is done.
- Wave 3 is closed for orchestration; follow-up chat work should be tracked as
  targeted hardening or Wave 4+ integration work.

## Wave 4: Runtime Routing and Event Bridge - Starting

Start these as the next active workstreams. They depend on the runtime-scoped
gateway pool and the Wave 2 diagnostics/config primitives.

| Branch | PR Title | Depends On | Intent | Risk |
| --- | --- | --- | --- | --- |
| `codex/gateway-chat-session-routing` | `fix: route chat sessions by runtime` | runtime-scoped pool | Route chat/history/sessions by selected agent runtime or explicit runtime. | High |
| `codex/runtime-scoped-event-bridge` | `fix: scope gateway event bridge by runtime` | runtime-scoped pool, schema approval | Make event bridge and session persistence runtime-scoped. | High |
| `codex/gateway-harness` | `test: add gateway reliability harness` | diagnostics/config helper | Add specs/fixtures for connect, sessions, chat, config, skill sync. | Medium |

### Wave 4 Notes

- Runtime session persistence requires explicit schema approval.
- Route changes should reject ambiguous runtime calls instead of silently using
  a global primary runtime.

## Wave 5: Model Management

These workstreams should start after read-only discovery and config patching
are stable.

| Branch | PR Title | Depends On | Intent | Risk |
| --- | --- | --- | --- | --- |
| `codex/model-profile-domain` | `feat: add model profile domain` | model discovery, schema approval | Persist reusable model profiles separate from assignment. | Medium |
| `codex/model-management-ui` | `feat: add model management page` | discovery/profile APIs | Show runtime models and model profiles without config writes. | Low-medium |
| `codex/agent-model-overrides` | `feat: add agent model overrides` | config helper, model profiles | Validate and sync explicit agent model overrides. | High |
| `codex/company-model-defaults` | `feat: add company model defaults` | model profiles | Add company default resolution without mutating explicit overrides. | Medium |

### Wave 5 Notes

- Assignment writes are higher risk than discovery and browsing.
- Keep precedence simple at first:
  1. agent override
  2. company default
  3. runtime default

## Wave 6: Desktop App

Desktop implementation should not start until the architecture ADR is accepted.

| Branch | PR Title | Depends On | Intent | Risk |
| --- | --- | --- | --- | --- |
| `codex/desktop-shell-scaffold` | `chore: scaffold desktop shell` | desktop ADR, package policy | Add isolated desktop shell that loads a CrewCmd server/dev URL. | Medium |
| `codex/desktop-native-contracts` | `docs: define desktop native capability contracts` | desktop shell scaffold | Define notifications, tray, deep links, and storage boundaries. | Medium |
| `codex/desktop-notifications` | `feat: add desktop notifications` | native contracts | Add first native value without local runtime bundling. | Medium |

### Wave 6 Notes

- Do not add secure token storage without explicit security review.
- Do not bundle OpenClaw runtime in the first desktop shell.
- Keep web server build independent from desktop packaging.

## Suggested Agent Assignment

With five active slots:

1. Agent A: chat critical path.
2. Agent B: gateway/runtime foundation.
3. Agent C: CI/API quality foundation.
4. Agent D: model discovery or diagnostics.
5. Agent E: desktop ADR or docs/contracts.

When a slot frees up, refill from the next eligible dependency-ready item.

## Stop Conditions

Stop and ask before continuing if:

- a workstream needs more than three changed files in one commit;
- schema changes are required but not approved;
- a branch needs to rewrite or force-push work not created by this task;
- runtime routing would change public workflow semantics;
- config writes could affect existing OpenClaw runtime behavior;
- desktop work requires secrets, secure storage, or production signing choices.

## Verification Standard

Every PR should at minimum run:

```bash
git diff --check
```

Add the smallest relevant verification:

- CI or package changes: `pnpm lint:check`, `pnpm typecheck`, `pnpm test`
- Chat route changes: targeted route tests plus `pnpm typecheck`
- Gateway pool changes: `pnpm test src/lib/gateway-chat-pool.test.ts`
- Model helpers: targeted model/profile tests
- UI changes: targeted component tests or Playwright smoke
- Desktop docs: `git diff --check`
- Desktop code: desktop launch smoke plus web `pnpm build`

## First Five Recommended Workstreams

Wave 1 started with:

1. `codex/chat-immediate-sse`
2. `codex/gateway-runtime-scoped-pool`
3. `codex/ci-lint-hygiene`
4. `codex/api-response-primitives`
5. `codex/desktop-architecture-adr`

That wave provided one critical user fix, one runtime foundation, two quality
foundations, and one desktop unblocker without overloading a single area of the
codebase. Wave 2 then completed the contract and diagnostics layer. New work
should now start from Wave 3.
