# Phase 3: Gateway Management and Runtime Configuration

## Goal

Make OpenClaw runtime connectivity inspectable, recoverable, and safe to
configure across multiple runtimes.

## Why This Matters

CrewCmd's differentiation depends on managing multiple runtimes. That creates
more failure modes than a single local desktop app:

- stale runtime URLs
- gateway auth failures
- pairing state drift
- runtime config conflicts
- LAN/Tailscale/IP changes
- long-running RPCs
- disconnected event bridges
- skill sync failures caused by config drift

Gateway management needs first-class diagnostics and guardrails before model
management and desktop distribution are layered on top.

## Workstreams

### 1. Gateway Health Model

Tasks:

- Define explicit gateway states:
  - `not_configured`
  - `connecting`
  - `connected`
  - `degraded`
  - `unresponsive`
  - `auth_failed`
  - `pairing_required`
  - `config_invalid`
- Track health reasons separately from the display state.
- Add timestamps for:
  - last connect attempt
  - last successful RPC
  - last failed RPC
  - last chat event
  - last session refresh

Acceptance criteria:

- UI can distinguish auth/config/pairing/network failures.
- Operators can see whether the gateway is connected but degraded.

### 2. Gateway Diagnostics API

Tasks:

- Add diagnostics endpoint for the primary runtime.
- Include:
  - runtime ID
  - configured URL
  - active connected URL
  - fallback URL attempts
  - pool size
  - active client holds
  - pending RPC count
  - event bridge status
  - recent error summary
- Redact tokens and secrets.

Acceptance criteria:

- Diagnostics are safe to paste into a bug report.
- The endpoint works without exposing runtime credentials.

### 3. Runtime URL and Connection Recovery

Tasks:

- Keep current fallback URL behavior.
- Record which fallback URL worked.
- Add clear UI when a stored URL was repaired.
- Add exponential reconnect/backoff for event bridge and gateway clients.
- Detect stale pooled connections before reuse.

Acceptance criteria:

- Local IP changes do not permanently break a runtime.
- Reconnect behavior is visible and bounded.

### 4. Config Validation and Patching

Tasks:

- Validate config patches before sending them to the gateway.
- Use base hashes or equivalent conflict detection when available.
- Make config writes idempotent.
- Log config patch intent:
  - actor
  - runtime
  - changed area
  - result
- Separate dry-run validation from write operations where possible.

Acceptance criteria:

- Config write failures are explained clearly.
- Concurrent config changes cannot silently overwrite each other.

### 5. Gateway Harness

Tasks:

- Add a lightweight harness inspired by ClawX.
- Start with specs for:
  - runtime import
  - gateway connect
  - sessions list
  - chat send
  - chat history
  - config get/patch
  - skill sync
- Add CI profile for harness checks that do not need a real runtime.

Acceptance criteria:

- High-risk gateway paths have documented expectations.
- Future AI coding work can validate changes against the harness.

## Suggested PR Sequence

1. `feat: add gateway health state model`
2. `feat: add gateway diagnostics endpoint`
3. `fix: classify gateway connection failures`
4. `fix: harden gateway client reuse`
5. `feat: validate runtime config patches`
6. `test: add gateway reliability harness`

## Verification

Targeted verification:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Additional scenario checks:

- Runtime URL unreachable.
- Runtime token invalid.
- Runtime requires pairing.
- Runtime local IP changed.
- Gateway disconnects during `sessions.list`.
- Gateway disconnects during active chat.
- Config patch fails due to conflict.

## Risks

- Diagnostics can accidentally expose sensitive runtime details if not redacted.
- Aggressive reconnect behavior can create noisy logs or repeated gateway load.
- Config patch validation can block legitimate advanced OpenClaw settings if too
  strict.

## Rollback Plan

Diagnostics and state classification can be rolled back independently from
config write hardening. Config patch changes should be guarded so they can fall
back to the previous write path during rollout.
