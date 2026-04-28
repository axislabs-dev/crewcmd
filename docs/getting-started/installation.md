# Installation

## Quick Start (Embedded Postgres)

No database setup required. CrewCmd runs with embedded Postgres locally via PGlite.

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). That's it.

Use `pnpm dev:https` only when you need HTTPS-only browser features such as microphone access, or when testing from another device on your local network.

## Docker Compose

```bash
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd
cp .env.example .env
# Edit .env and set AUTH_SECRET before exposing this service.
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
| pnpm | 9.15.0+ | Required; see `packageManager` in `package.json` |
| Docker | Latest | Optional, for containerized deployment |

## What's Next

- [Configuration](configuration.md) — Environment variables and settings
- [Authentication](authentication.md) — Set up login and API tokens
- [Deploy Your First Team](../guides/deploy-first-team.md) — Get agents running
