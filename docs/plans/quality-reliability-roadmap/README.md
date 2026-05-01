# CrewCmd Quality and Product Hardening Roadmap

This plan turns the ClawX comparison into a reviewable execution path for
CrewCmd. The sequence is intentional: improve the codebase and runtime
transparency first, then add broader product surfaces such as model management
and desktop distribution.

## Objectives

1. Improve the quality of the codebase.
2. Harden chat reliability and transparency.
3. Harden gateway management and runtime configuration.
4. Add model management similar to ClawX, adapted for CrewCmd's multi-runtime
   and team-management model.
5. Create a desktop app release path.

## Product Differentiation

CrewCmd should not try to be a ClawX clone. ClawX is strongest as a polished
local desktop interface for OpenClaw. CrewCmd should become the operating layer
for teams using agents across surfaces and runtimes.

CrewCmd's differentiated position:

- Mobile app
- Desktop app
- Web server
- Multiple OpenClaw runtime connections
- Team and agent hierarchy management
- Skill management across agents and runtimes
- Task, inbox, governance, and audit workflows

## Phase Map

Status as of 2026-05-01: Wave 1 foundation PRs and Wave 2 contract and
diagnostics PRs have merged. The roadmap sequence remains the same, but active
coordination should now start from Wave 3 in the orchestration plan.

| Phase | Focus | Outcome |
| --- | --- | --- |
| [Phase 1](phase-1-quality-baseline.md) | Code quality baseline | Safer CI, smaller modules, consistent errors |
| [Phase 2](phase-2-chat-hardening.md) | Chat reliability and transparency | No long opaque agent runs |
| [Phase 3](phase-3-gateway-management.md) | Gateway management and config | Inspectable, recoverable runtimes |
| [Phase 4](phase-4-model-management.md) | Model/provider management | Team-aware model selection and validation |
| [Phase 5](phase-5-desktop-app.md) | Desktop app release path | Releasable desktop shell around CrewCmd |

See the [Concurrent Orchestration Plan](orchestration-plan.md) for branch,
agent, and PR sequencing with a five-workstream concurrency cap.

## Recommended Order

1. Treat the merged Wave 1 foundation as complete for coordination purposes.
2. Treat the merged Wave 2 contract and diagnostics work as complete for
   coordination purposes.
3. Begin Wave 3 chat transparency work from the orchestration plan.
4. Add runtime routing, event bridge, and gateway harness checks after the chat
   transparency stack is underway.
5. Add model assignment on top of stable runtime plumbing.
6. Build the desktop shell after chat and runtime behavior are reliable.

## Definition of Done

The roadmap is complete when CrewCmd can reliably show what agents are doing
across web, mobile, and desktop, while managing multiple runtimes, teams,
skills, and models through reviewable, tested workflows.
