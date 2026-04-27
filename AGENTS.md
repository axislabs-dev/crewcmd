# Repository Agent Guide
Version: 2026-04-28

## Purpose

CrewCMD is an open-source OpenClaw management layer for orchestrating agents, repos, PRs, and review workflows.

## Repository Type

Current type: community OSS / internal tooling.

## Default Mode

Work on a branch unless explicitly told otherwise. Use atomic commits, keep PRs reviewable, verify before completion, and return a review pack.

## Repo Layout

- `src/app/` - Next.js App Router pages and API routes
- `components/` - shared React components
- `db/` - Drizzle schema, database adapters, and seed data
- `lib/` - app services, skills, runtime, and orchestration helpers
- `docs/` - design notes and architecture docs
- `e2e/` - Playwright tests
- `.github/workflows/` - CI workflows
- `scripts/` - automation scripts

## Commands

Install: `pnpm install`

Test: `pnpm test`

Lint: `pnpm lint`

Typecheck: `pnpm typecheck`

Build: `pnpm build`

Smoke test: `git diff --check`

## Work Policy

Before editing, report:

1. objective
2. expected blast radius
3. files likely to change
4. commit plan
5. verification plan
6. risk level

## Commit Policy

Use Conventional Commits. One commit equals one reviewable intent.

Do not mix implementation and unrelated docs, tests for one feature with implementation of another, dependency bumps with behaviour changes, formatting-only changes with logic changes, or generated files with unrelated hand-written code.

## PR Policy

Good PRs can be reviewed in under 15 minutes, have a clear summary, focused commits, verification, risk notes, and follow-up tasks when incomplete.

Bad PRs include broad rewrites, unrelated formatting churn, mixed behaviour/config/dependency changes, no verification, vague summaries, or risky production changes without approval.

Do not merge without explicit human approval.

## Stop Before Touching

Ask before changing auth, security, payments, billing, production data, migrations, secrets, public API compatibility, plugin APIs, config formats, install/update flow, telemetry/privacy behaviour, destructive commands, or production configuration.

## CrewCMD-Specific Policy

CrewCMD should optimise for:

- clear CLI behaviour
- safe orchestration
- predictable agent workflows
- readable logs
- branch/PR visibility
- reviewable automation
- maintainer trust

Do not change public CLI commands, config formats, or workflow semantics without explicitly calling it out.

Preferred PR types:

- one CLI command improvement
- one workflow improvement
- one review-pack improvement
- one OpenClaw integration improvement
- one docs improvement
- one CI/test improvement

Avoid broad rewrites and hidden behaviour changes.

## Review Pack Required

At the end of every task, return:

```md
## Review Pack
Repo:
Branch:
PR:
Task:
Status:
Summary:
Commits:
Files changed:
Verification:
Risk level:
Rollback plan:
Human decision needed:
Next recommended task:
```
