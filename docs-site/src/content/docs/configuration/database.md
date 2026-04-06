---
title: Database Setup
description: Configure Postgres for CrewCmd — PGlite for dev, Neon for production.
---

CrewCmd supports two database modes:

## PGlite (Development)

By default, CrewCmd uses **PGlite** — an embedded, in-browser Postgres implementation. No setup required.

```bash
# Just run the dev server — PGlite is automatic
pnpm dev
```

PGlite data persists in memory during the dev session but resets on restart. It's perfect for development and testing.

## Neon (Production)

For production or persistent data, connect to a [Neon](https://neon.tech) serverless Postgres instance.

### Setup

1. Create a Neon project at [console.neon.tech](https://console.neon.tech)
2. Copy the connection string
3. Set it in your environment:

```bash
# .env.local
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/crewcmd?sslmode=require
```

4. Run migrations:

```bash
pnpm db:migrate
```

5. Optionally seed with demo data:

```bash
pnpm db:seed
```

### Schema Management

CrewCmd uses **Drizzle ORM** for schema management. The schema is defined in `src/db/schema.ts` (30+ tables).

```bash
# After modifying schema.ts, generate a migration
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Open Drizzle Studio (visual DB browser)
pnpm db:studio
```

### Cold Start Handling

All Neon queries use a `withRetry()` wrapper to handle serverless cold starts gracefully. This is built into the data access layer — no configuration needed.
