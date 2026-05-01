# Phase 4: Model Management

## Goal

Add ClawX-style model/provider management while preserving CrewCmd's
multi-runtime, team-aware product direction.

## Product Direction

CrewCmd should manage models at several levels:

- runtime capabilities
- company defaults
- team defaults
- agent overrides
- task-specific or automation-specific overrides later

ClawX is focused on configuring models for a local desktop runtime. CrewCmd
should extend that concept to teams and multiple OpenClaw gateways.

## Workstreams

### 1. Runtime Model Discovery

Tasks:

- Call gateway `models.list` for each connected runtime.
- Store or cache discovered models with:
  - runtime ID
  - provider
  - model ID
  - display name
  - context window if available
  - reasoning support if available
  - discovered timestamp
- Show discovery errors without blocking other runtimes.

Acceptance criteria:

- CrewCmd can list available models per runtime.
- A failed runtime does not prevent model management for healthy runtimes.

### 2. Provider and Model Profiles

Tasks:

- Define model profile shape:
  - provider
  - model
  - runtime scope
  - reasoning mode support
  - optional cost metadata
  - optional context-window metadata
- Add UI for browsing model profiles.
- Keep profile creation separate from assigning a profile to an agent.

Acceptance criteria:

- Operators can understand which runtime/provider/model combination is being
  used.
- Profiles are reusable across agents where runtime compatibility allows it.

### 3. Agent Model Overrides

Tasks:

- Add per-agent model override support.
- Validate that the selected model exists on the agent's runtime.
- Clearly show inherited defaults versus explicit overrides.
- Sync model changes to OpenClaw runtime config through the hardened gateway
  config path.

Acceptance criteria:

- Agents can inherit the company default.
- Agents can opt into a runtime-compatible override.
- Invalid overrides are rejected before config write.

### 4. Company and Team Defaults

Tasks:

- Add company-level default model profile.
- Add team-level defaults later if the hierarchy requires it.
- Define precedence:
  1. task or automation override, future
  2. agent override
  3. team default, future
  4. company default
  5. runtime default

Acceptance criteria:

- The UI can explain why an agent uses a specific model.
- Changing a company default does not unexpectedly override explicit agent
  choices.

### 5. Validation and Usage Visibility

Tasks:

- Validate provider credentials through runtime diagnostics where possible.
- Add model availability checks before saving assignments.
- Later: surface token usage and cost trends by model, agent, and runtime.

Acceptance criteria:

- Users get actionable validation errors.
- Model assignments are auditable.

## Suggested PR Sequence

1. `feat: discover runtime models`
2. `feat: add model profile data model`
3. `feat: show model management page`
4. `feat: add agent model overrides`
5. `feat: add company default model profile`
6. `test: cover model assignment validation`

## Verification

Targeted checks:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Scenario checks:

- Runtime returns no models.
- Runtime returns provider/model metadata.
- Runtime is offline.
- Agent uses inherited default.
- Agent uses explicit override.
- Override becomes invalid after runtime changes.

## Risks

- Model assignment touches runtime config and can affect production agent
  behavior.
- Provider credentials may be sensitive.
- Multi-runtime compatibility can become confusing if the UI does not explain
  scope clearly.

## Rollback Plan

Keep discovery read-only in the first PR. Add config writes only after gateway
config validation is in place. Agent overrides should be nullable so reverting
to inherited defaults is straightforward.
