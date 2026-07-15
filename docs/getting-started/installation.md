# Installation

## Support Status

CrewCmd currently supports one installation path for contributor evaluation
and the controlled OSS preview. Other paths are available for testing but are
not yet certified production release channels.

| Path | Status | Notes |
|---|---|---|
| Source checkout + embedded PGlite | **Supported preview path** | Node.js 22, pnpm 9.15, and no external database |
| Docker Compose + Postgres | **Preview** | Requires clean-host, persistence, backup, and restore QA in [#668](https://github.com/rogerchappel/crewcmd/issues/668) |
| External Postgres or platform deploy | **Preview** | Validate migrations, TLS, backups, and rollback for the target environment |
| npm CLI, desktop package, server archive, published container image | **Deferred** | Do not advertise or depend on these until versioned public artifacts exist |

## Supported Preview Path (Embedded PGlite)

No database setup required. CrewCmd runs with embedded Postgres locally via PGlite.

```bash
git clone https://github.com/rogerchappel/crewcmd.git
cd crewcmd
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). That's it.

Confirm that `http://localhost:3000/api/health` responds successfully, create
the first account, and keep the generated `.data/pglite` directory with the
checkout. See the [self-hosting guide](../guides/self-hosting.md) before moving
or updating an instance.

Use `pnpm dev:https` only when you need HTTPS-only browser features such as microphone access, or when testing from another device on your local network.

## Docker Compose (Preview)

Do not treat this as a certified production path until the manual checks in
[#668](https://github.com/rogerchappel/crewcmd/issues/668) are recorded for the
target host.

```bash
git clone https://github.com/rogerchappel/crewcmd.git
cd crewcmd
cp .env.example .env
# Edit .env and set a non-default AUTH_SECRET before exposing this service.
docker compose up --build -d
curl --fail http://localhost:3000/api/health
docker compose logs app
```

Use `docker compose down` to stop the preview without deleting its database
volume. Back up Postgres before updates; the commands are in the
[self-hosting guide](../guides/self-hosting.md).

## External Postgres (Preview)

Use Neon, Supabase, or any Postgres instance:

```bash
cp .env.example .env.local
# Edit .env.local — set DATABASE_URL to your connection string
pnpm install
pnpm db:migrate
pnpm dev
```

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22+ | Required |
| pnpm | 9.15.0+ | Required; see `packageManager` in `package.json` |
| Docker | Latest | Optional, for containerized deployment |

## Published Artifacts

There is currently no supported npm CLI, desktop installer, prebuilt server
archive, or published container image. Install from a source checkout. Release
and artifact publication remain tracked in
[#665](https://github.com/rogerchappel/crewcmd/issues/665).

## What's Next

- [Configuration](configuration.md) — Environment variables and settings
- [Authentication](authentication.md) — Set up login and API tokens
- [Deploy Your First Team](../guides/deploy-first-team.md) — Get agents running
