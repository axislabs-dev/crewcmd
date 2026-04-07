# Configuration

CrewCmd uses environment variables for configuration. Copy `.env.example` to `.env.local` and edit as needed.

## Environment Variables

### Required

| Variable | Description | Default |
|---|---|---|
| `NEXTAUTH_SECRET` | Session encryption key | Auto-generated in dev |
| `NEXTAUTH_URL` | Your deployment URL | `https://localhost:3000` |

### Database

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Uses embedded PGlite if not set |
| `DB_MODE` | `pglite` or `postgres` | Auto-detected from DATABASE_URL |

### Authentication

| Variable | Description | Default |
|---|---|---|
| `GITHUB_ID` | GitHub OAuth app client ID | — |
| `GITHUB_SECRET` | GitHub OAuth app client secret | — |
| `HEARTBEAT_SECRET` | API token for agent/cron access | — |

### AI Providers

Provider API keys are configured in the CrewCmd UI under Settings > Provider Keys. No environment variables needed.

### Optional

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |

## PGlite (Embedded Postgres)

When no `DATABASE_URL` is set, CrewCmd runs an embedded Postgres instance using PGlite. Data is stored locally in `.pglite/`. This is great for:

- Local development
- Single-user self-hosting
- Trying CrewCmd without any infrastructure

For production or multi-user deployments, use an external Postgres instance.
