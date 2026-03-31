# CrewCmd

> Your AI team, ready to work.

Build, deploy, and manage a team of AI agents that work alongside your people. Pick from pre-built team templates or bring your own agents. Works for solo founders, small teams, and growing companies.

**One-click team deployment · Agent inbox · Skills marketplace · Task management · Team structure · Budgets & governance**

## Why CrewCmd?

Most AI tools give you one agent at a time. CrewCmd gives you a whole team.

- **Deploy a team in one click** — Choose from 8 pre-built team templates (dev squad, marketing team, support ops, solo founder kit, and more). Customize and deploy in seconds.
- **Bring your own agents** — Connect Claude Code, Codex, Gemini, Cursor, OpenCode, or any agent via API. Mix and match.
- **Agent inbox** — Your agents surface decisions, blockers, and completed work. Review and approve from one place, not scattered notifications.
- **Skills marketplace** — Browse and install agent capabilities from ClawHub, skills.sh, and GitHub.
- **Access control** — Private agents, shared agents, team-wide agents. Control who uses what.
- **Task management** — Kanban boards, project tracking, and time logging for humans and agents working together.
- **Team structure** — Visual org chart showing who reports to whom, human and AI.
- **Budgets & governance** — Set spending limits, approval gates, and audit trails.

## Quick Start

No database setup required. CrewCmd runs with embedded Postgres locally.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
# Open http://localhost:3000
```

That's it. No Docker, no cloud database, no config files.

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
- GitHub OAuth app (optional, for team auth)

## Features

| Feature | Description |
|---|---|
| **Team Blueprints** | Pre-built agent team templates. One click to deploy a full team with roles, hierarchy, and skills. |
| **Multi-Adapter Agents** | Connect any AI tool: Claude Code, Codex, Gemini, Cursor, OpenCode, OpenRouter, or custom API. |
| **Agent Inbox** | Centralized communication hub. Agents surface decisions, blockers, and updates with priority tiers. |
| **Skills Marketplace** | Browse, install, and manage agent capabilities from ClawHub, skills.sh, and GitHub. |
| **Access Tiers** | Private, assigned, or team-wide agent visibility. Per-user permissions for interact, configure, and view. |
| **Task Board** | Kanban and table views with full lifecycle tracking. |
| **Team Structure** | Visual org chart for human and AI team members. |
| **Budgets** | Per-agent spending limits, cost tracking, and approval gates. |
| **Voice Chat** | Talk to your agents with speech-to-text and text-to-speech. |
| **Light & Dark Themes** | Professional light theme for everyday use. Dark ops theme for power users. |
| **Simple & Pro Modes** | Simple mode hides technical complexity. Pro mode shows everything. |

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19, Tailwind CSS 4
- **Database:** PGlite (embedded, zero-config) or external Postgres
- **ORM:** Drizzle
- **Auth:** NextAuth v5 (GitHub OAuth)
- **Hosting:** Self-hosted, Vercel, or Docker

## Contributing

CrewCmd is open source under the MIT license. Contributions welcome.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
```

See [CLAUDE.md](./CLAUDE.md) for the project plan and architecture notes.

## License

MIT © 2026 Axislabs
