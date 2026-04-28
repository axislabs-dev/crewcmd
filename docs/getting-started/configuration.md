# Configuration

CrewCmd uses environment variables for configuration. Copy `.env.example` to `.env.local` for local `pnpm dev`, or to `.env` for Docker Compose.

## Environment Variables

### Local Development

No environment variables are required for the default local path. If `DATABASE_URL` is unset, CrewCmd uses embedded PGlite. In development, `AUTH_SECRET` has a local-only fallback.

### Required for Exposed Deployments

| Variable | Description | Default |
|---|---|---|
| `AUTH_SECRET` | Auth.js session encryption key | Local-only fallback in dev |
| `NEXT_PUBLIC_APP_URL` | Public URL for callbacks and generated links | `http://localhost:3000` |

### Database

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Uses embedded PGlite if not set |
| `POSTGRES_PASSWORD` | Docker Compose Postgres password | `crewcmd` |

### Authentication and API Access

| Variable | Description | Default |
|---|---|---|
| `HEARTBEAT_SECRET` | API token for agent/cron access | — |

`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are present in `.env.example` as reserved GitHub OAuth settings, but the default auth provider currently uses email/password credentials only.

### AI Providers

Provider API keys are configured in the CrewCmd UI under Settings > Provider Keys. No environment variables needed.

### Optional

| Variable | Description | Default |
|---|---|---|
| `APP_PORT` | Docker Compose app port | `3000` |
| `POSTGRES_PORT` | Docker Compose Postgres host port | `5432` |
| `OPENCLAW_GATEWAY_URL` | Optional OpenClaw gateway URL | — |
| `BLOB_READ_WRITE_TOKEN` | Optional Vercel Blob token for uploaded assets | — |
| `NODE_ENV` | `development` or `production` | `development` |

## PGlite (Embedded Postgres)

When no `DATABASE_URL` is set, CrewCmd runs an embedded Postgres instance using PGlite. Data is stored locally in `.pglite/`. This is great for:

- Local development
- Single-user self-hosting
- Trying CrewCmd without any infrastructure

For production or multi-user deployments, use an external Postgres instance.
