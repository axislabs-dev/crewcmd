---
title: Quick Start
description: Get CrewCmd running locally in under a minute.
---

CrewCmd is designed for zero-config local development. No database setup, no environment variables — just install and run.

## Prerequisites

- **Node.js** 20+
- **pnpm** 9.15+

## Install & Run

```bash
# Clone the repository
git clone https://github.com/axislabs-dev/crewcmd.git
cd crewcmd

# Install dependencies
pnpm install

# Start the dev server (HTTPS with self-signed cert)
pnpm dev:https
```

That's it. CrewCmd uses an embedded **PGlite** database in development, so there's no need to set up Postgres. Auth secrets are auto-generated on first startup.

Open [https://localhost:3000](https://localhost:3000) to see the app.

## Using an External Database

For production or when you want persistent data across restarts, connect to a Neon Postgres instance:

```bash
# Create .env.local
echo 'DATABASE_URL=postgresql://...' > .env.local

# Run migrations
pnpm db:migrate

# Optionally seed with demo data
pnpm db:seed

# Start the dev server
pnpm dev
```

## Available Scripts

| Script | Description |
|--------|------------|
| `pnpm dev` | Start dev server with Turbopack |
| `pnpm dev:https` | Start dev server with HTTPS (self-signed cert) |
| `pnpm build` | Production build |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run Vitest test suite |
| `pnpm db:generate` | Generate Drizzle migration after schema changes |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm db:seed` | Seed database with demo data |
| `pnpm db:studio` | Open Drizzle Studio (DB GUI) |

## Next Steps

- [Project Structure](/getting-started/project-structure/) — Understand the codebase layout
- [Configuration](/configuration/environment-variables/) — Configure environment variables for production
- [Creating Agents](/agents/creating-agents/) — Set up your first AI agent
