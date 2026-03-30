# CrewCmd

> Open-source agent crew orchestration. Your crew. Your command.

CrewCmd is a self-hosted dashboard for orchestrating teams of AI agents. Task management, org charts, budgets, governance, and goal alignment — all in one place.

Built for hybrid human+agent teams. Works with any AI agent that can receive a heartbeat.

## Features

- **Task Board** — Kanban + table views with full lifecycle tracking (backlog → done)
- **Agent Management** — Register agents, track status, assign work, monitor heartbeats
- **Project Management** — Organize work by project with context and documents
- **Activity Feed** — Real-time audit trail of all agent actions
- **GitHub Integration** — PR tracking, review cycles, webhook-driven updates
- **Voice Chat** — Talk to your crew with STT/TTS (OpenAI Whisper + TTS)
- **Time Tracking** — Log human time alongside agent work
- **Role-Based Access** — Super admin, admin, viewer roles with GitHub OAuth
- **API-First** — RESTful API for all entities, Bearer token auth

## Quick Start

### Option 1: Zero config (PGlite)

No database setup required — uses embedded Postgres locally.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
# Open http://localhost:3000
```

### Option 2: Docker Compose

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
docker compose up
# Open http://localhost:3000
```

### Option 3: External Postgres (Neon, Supabase, self-hosted)

```bash
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL
pnpm install
pnpm db:push
pnpm dev
```

### Requirements

- Node.js 22+ and pnpm (Options 1 & 3)
- Docker (Option 2)
- GitHub OAuth app (optional, for auth — falls back to env allowlist)

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19 + Tailwind CSS 4
- **ORM:** Drizzle
- **Database:** Neon (serverless Postgres)
- **Auth:** NextAuth v5 (GitHub OAuth)
- **Hosting:** Vercel (or self-host)

## Roadmap

See [CLAUDE.md](./CLAUDE.md) for the full project plan and phase breakdown.

- **Phase 0** ✅ — Foundation (rebrand, clean up, open-source ready)
- **Phase 1** — Multi-tenancy & goal hierarchy
- **Phase 2** — Budget & cost control
- **Phase 3** — Governance & org chart
- **Phase 4** — Heartbeat scheduling & autonomy
- **Phase 5** — Plugin system & templates
- **Phase 6** — SaaS & cloud

## License

MIT © 2026 Axislabs
