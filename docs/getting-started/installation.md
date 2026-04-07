# Installation

## Quick Start (Embedded Postgres)

No database setup required. CrewCmd runs with embedded Postgres locally via PGlite.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev:https
```

Open [https://localhost:3000](https://localhost:3000). That's it.

HTTPS is required for voice features (microphone access needs a secure context).

## Docker Compose

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
docker compose up
```

## External Postgres

Use Neon, Supabase, or any Postgres instance:

```bash
cp .env.example .env.local
# Edit .env.local — set DATABASE_URL to your connection string
pnpm install
pnpm db:push
pnpm dev
```

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22+ | Required |
| pnpm | Latest | Required |
| Docker | Latest | Optional, for containerized deployment |
| GitHub OAuth app | — | Optional, for team auth |

## What's Next

- [Configuration](configuration.md) — Environment variables and settings
- [Authentication](authentication.md) — Set up login and API tokens
- [Deploy Your First Team](../guides/deploy-first-team.md) — Get agents running
