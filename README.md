# CrewCmd

> Give your team AI superpowers.

> Author's note: CrewCmd is still early. This README reflects what works today and the direction the product is heading, but some roadmap items are still in progress rather than fully shipped.

<p align="center">
  <img src="docs/images/crewcmd-intro.gif" alt="CrewCmd Introduction" width="800" />
</p>

CrewCmd is the AI-native workspace where humans and AI agents work side by side: same task board, same inbox, and an agent org chart. Every person on your team gets AI agents that multiply what they can do. Your team of 3 operates like a team of 30.

**Built for small teams that want to punch way above their weight.**

A solo founder can deploy a full dev squad, marketing team, and support ops in minutes. A 5-person startup can run like a 50-person company. That's the idea.

**One-click team deployment · Agent inbox · Skills management · Task management · Agent team structure · OpenClaw runtime integration**

<p align="center">
  <img src="docs/images/team-org-chart.png" alt="CrewCmd Team Org Chart" width="800" />
  <br />
  <em>Visual org chart for AI agents and delegation paths</em>
</p>

## Why CrewCmd?

Other platforms treat AI agents as tools you configure. CrewCmd treats them as team members you manage. The difference matters.

- **Deploy a full team in one click** — Pre-built team templates let you spin up a dev squad, marketing team, support crew, solo founder setup, and more. Customize roles, hierarchy, and skills before deploying, or just hit go.
- **Bring your own OpenClaw agents** — Import agents from an OpenClaw runtime and manage them in CrewCmd. Teams can bring their own personal OpenClaw agents, and companies can also provide shared or dedicated OpenClaw agents for team members.
- **One inbox for everything** — Agents surface decisions, blockers, and completed work with priority tiers. No more checking 7 different tools. Review and approve from one place.
- **Skills management** — Install, configure, and sync skills to your agents. CrewCmd includes built-in skills and can browse curated external skill sources, but the experience today is primarily about managing installed skills.
- **Workspace access control** — Personal agents can stay private, and company-owned agents can be shared with team or org visibility.
- **Humans and agents on the same board** — Task management, project tracking, and time logging that works for both. See who's doing what, human or AI.
- **Agent team structure** — Visual org chart for agents with reporting lines and delegation paths.
- **Governance foundation** — Approval-gate and audit-trail primitives exist in the codebase, but the full guardrail workflow is still a work in progress.

<p align="center">
  <img src="docs/images/chat-interface.png" alt="CrewCmd Hands-Free Chat" width="400" />
  <br />
  <em>Hands-free voice chat with your agents, from anywhere</em>
</p>

## Quick Start

No database setup required. CrewCmd runs with embedded Postgres locally.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev:https
# Open https://localhost:3000
```

That's it. No Docker or cloud database required for local development. HTTPS is required for voice features because microphone access needs a secure context.

### Other deployment options

**Docker Compose:**
```bash
docker compose up
```

**External Postgres (Neon, Supabase, self-hosted):**
```bash
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL
pnpm install
pnpm db:push
pnpm dev
```

### Requirements

- Node.js 22+ and pnpm
- Docker (optional, for containerized deployment)

## Features

| Feature | Description |
|---|---|
| **Team Blueprints** | Pre-built agent team templates. One click to deploy a full team with roles, hierarchy, and skills. |
| **OpenClaw Runtime Import** | Import and manage agents from an OpenClaw runtime, including runtime metadata and workspace sync. |
| **Agent Inbox** | Centralized communication hub. Agents surface decisions, blockers, and updates with priority tiers. |
| **Skills Management** | Install, configure, and manage agent skills, including curated browse/import flows and runtime sync. |
| **Access Tiers** | Private personal agents plus team/org visibility for company-owned agents. |
| **Task Board** | Kanban and table views with full lifecycle tracking. |
| **Team Structure** | Visual org chart for agents, with reporting lines and delegation paths. |
| **Governance Foundations** | Approval gates, config versioning, and audit log primitives are present, with broader workflows still in progress. |
| **Voice Chat** | Talk to your agents with speech-to-text and text-to-speech. |
| **Light & Dark Themes** | Professional light theme for everyday use. Dark ops theme for power users. |

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19, Tailwind CSS 4
- **Database:** PGlite (embedded, zero-config) or external Postgres
- **ORM:** Drizzle
- **Auth:** Auth.js / NextAuth v5 with credentials auth
- **Hosting:** Self-hosted, Vercel, or Docker

## Contributing

CrewCmd is source-available under the [BSL 1.1](./LICENSE). Contributions welcome.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev:https
```

See [CLAUDE.md](./CLAUDE.md) for the project plan and architecture notes.

## License

[BSL 1.1](./LICENSE) © 2026 RSCreative Technologies Pty Ltd. Converts to Apache 2.0 on 2030-03-31.
