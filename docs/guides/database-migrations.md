# Database Migrations

CrewCmd uses Drizzle SQL migrations as the durable schema path for local, self-hosted, and hosted Postgres deployments.

## Standard Commands

```bash
pnpm db:migrate
```

Use `db:migrate` for existing databases and production-like environments.

```bash
pnpm db:generate
```

Use `db:generate` after changing `src/db/schema.ts`.

Avoid `pnpm db:push` for shared, live, or long-lived databases. `db:push` can be useful for disposable scratch databases, but it bypasses migration history and can leave future `db:migrate` runs unable to tell what has already been applied.

## Diagnose A Database

```bash
pnpm db:doctor
```

The doctor loads `.env` and `.env.local`, connects to `DATABASE_URL`, and reports:

- how many rows exist in `drizzle.__drizzle_migrations`
- the latest recorded migration timestamp
- how many public tables exist
- the latest migration registered in `drizzle/meta/_journal.json`

If the database has tables but no migration rows, it was probably created with `db:push`, manual SQL, or an older migration setup. Do not rerun all migrations. Baseline the migration table to the last migration already represented in the schema, then run `pnpm db:migrate`.

## Baseline An Existing Database

Read the proposed SQL first:

```bash
pnpm db:doctor -- --baseline-through 0021_workspace_scoped_skills
```

Apply only when you are sure the schema already includes that migration:

```bash
pnpm db:doctor -- --baseline-through 0021_workspace_scoped_skills --apply --yes
pnpm db:migrate
```

The baseline command refuses to write if `drizzle.__drizzle_migrations` already has rows. It only inserts one migration-history row; it does not create or alter application tables.

Before baselining a non-disposable database, take a backup:

```bash
pg_dump "$DATABASE_URL" > crewcmd-backup-$(date +%Y%m%d).sql
```
