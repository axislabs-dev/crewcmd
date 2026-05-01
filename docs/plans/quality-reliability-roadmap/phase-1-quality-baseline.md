# Phase 1: Code Quality Baseline

## Goal

Make future changes safer and easier to review before expanding the product
surface area.

## Why This Comes First

Chat, gateway, model management, and desktop release work all touch shared
runtime paths. Without stronger quality gates and smaller modules, reliability
work will be harder to verify and easier to regress.

## Current Signals

- CI runs typecheck, tests, and build, but does not run a non-mutating lint
  check.
- `pnpm lint` currently runs ESLint with `--fix`, which is useful locally but
  not ideal as a CI gate.
- Several UI and route files are large enough to hide unrelated behavior:
  - `src/app/chat/page.tsx`
  - `src/app/api/chat/route.ts`
  - `src/components/task-board.tsx`
  - `src/components/agent-profile-panel.tsx`
- API error responses are inconsistent across route handlers.

## Workstreams

### 1. CI and Lint Hygiene

Tasks:

- Add `lint:check` as `eslint .`.
- Keep `lint` as the local autofix command if desired.
- Run `pnpm lint:check` in CI.
- Align `eslint-config-next` with the installed Next.js major version.
- Add `git diff --check` to local verification guidance.

Acceptance criteria:

- CI fails on lint errors without mutating files.
- The lint command is clearly documented.
- Existing test and build checks still run.

### 2. TypeScript Strictness

Tasks:

- Audit current violations for `noUnusedLocals`, `noUnusedParameters`, and
  `noFallthroughCasesInSwitch`.
- Enable each rule separately after cleanup.
- Prefer focused cleanup PRs over broad formatting churn.

Acceptance criteria:

- New unused code is blocked.
- No large unrelated cleanup commit is required.

### 3. Shared API and Error Primitives

Tasks:

- Define a route response helper for success and errors.
- Standardize error shape across API routes:
  - `code`
  - `message`
  - `details`
  - optional `requestId`
- Add client-side parsing helpers for consistent UI messages.
- Keep sensitive details out of public error payloads.

Acceptance criteria:

- New API routes use the shared response helper.
- Existing chat and gateway routes can progressively migrate.
- Error handling is testable without UI snapshots.

### 4. Module Decomposition

Tasks:

- Split only where it supports upcoming reliability work.
- Start with chat:
  - extract request building
  - extract stream parsing
  - extract active-run state
  - extract voice/TTS concerns where practical
- Avoid broad visual redesign during decomposition.

Acceptance criteria:

- Each extraction preserves behavior.
- Each commit changes three files or fewer.
- Tests or smoke checks cover the moved behavior.

## Suggested PR Sequence

1. `ci: add lint check`
2. `chore: align next eslint config`
3. `refactor: add api response helpers`
4. `refactor: extract chat stream parser`
5. `refactor: extract chat active-run state`

## Verification

Run the smallest relevant checks per PR:

```bash
pnpm lint:check
pnpm typecheck
pnpm test
git diff --check
```

Use `pnpm build` when changing Next config, route behavior, or shared frontend
structure.

## Risks

- Enabling strict rules too early may create noisy cleanup work.
- Refactoring large files before adding tests can move bugs around without
  improving confidence.

## Rollback Plan

Each quality gate should be revertible independently. If a strict rule blocks
urgent work, temporarily disable that specific rule and keep the cleanup task
tracked.
