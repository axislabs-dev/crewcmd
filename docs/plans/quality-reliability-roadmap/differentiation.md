# CrewCmd Differentiation

## Positioning

CrewCmd should be the team operating layer for agentic work, not just another
single-runtime chat client.

ClawX is strong as a local desktop interface for OpenClaw. CrewCmd should win
by coordinating humans, agents, tasks, runtimes, skills, and governance across
web, mobile, and desktop.

## Core Differentiators

### Mobile App

CrewCmd should support quick review, approvals, inbox triage, task updates, and
agent chat from mobile devices.

Quality bar:

- Fast access to agent status.
- Clear notifications.
- Safe approval flows.
- Mobile-friendly chat transparency.

### Desktop App

The desktop app should provide a persistent operational console.

Quality bar:

- Native notifications.
- Tray presence.
- Local gateway discovery.
- Reliable long-running chat visibility.
- Same team/runtime state as the web server.

### Web Server

The web server is the shared source of truth for teams.

Quality bar:

- Deployable by teams and companies.
- Works for multiple users.
- Keeps audit and governance records.
- Does not depend on one local machine.

### Multiple Runtime Connections

CrewCmd should manage more than one OpenClaw runtime.

Quality bar:

- Per-runtime health.
- Per-runtime models and skills.
- Runtime ownership and access control.
- Safe connection repair and diagnostics.

### Team Management

CrewCmd should model humans and agents as members of a shared operating system.

Quality bar:

- Agent hierarchy.
- Human ownership.
- Role and access boundaries.
- Task assignment and accountability.

### Skill Management

CrewCmd should manage skills across agents and runtimes.

Quality bar:

- Install, configure, sync, and audit skills.
- Scope secrets safely.
- Show sync status and failures clearly.
- Avoid hidden runtime drift.

## Strategic Moat

The strongest moat is not chat alone. The moat is operational trust:

- transparent agent runs
- recoverable runtime connectivity
- auditable config changes
- controlled model assignment
- governed skills and secrets
- shared team workflows

## Product Rule

Every new surface should reuse the same core state and reliability mechanisms.
If web, mobile, and desktop each handle chat or runtime health differently,
CrewCmd will become harder to trust.
