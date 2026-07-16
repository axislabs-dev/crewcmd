# Configuration

CrewCmd uses environment variables for configuration. Copy `.env.example` to `.env.local` for local `pnpm dev`, or to `.env` for Docker Compose.

## Environment Variables

### Local Development

No environment variables are required for the default local path. If `DATABASE_URL` is unset, CrewCmd uses embedded PGlite. In development, `AUTH_SECRET` has a local-only fallback.

### Required for Exposed Deployments

| Variable | Description | Default |
|---|---|---|
| `AUTH_SECRET` | Auth.js session encryption key | Local-only fallback in dev |
| `AUTH_URL` | Canonical Auth.js origin for production sign-in | Required in production source/Node deployments |
| `NEXT_PUBLIC_APP_URL` | Public URL for callbacks and generated links | `http://localhost:3000` |

For production, set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same public
HTTP(S) origin, including any non-default port. Use an origin only, such as
`https://crewcmd.example.com`, with no path, credentials, query, or fragment.
Docker Compose and CrewCMD-generated Docker configurations derive `AUTH_URL`
from `NEXT_PUBLIC_APP_URL` so the values cannot drift.

CrewCMD does not accept `AUTH_TRUST_HOST=true` as a substitute for a canonical
`AUTH_URL` in production. This prevents an operator from enabling arbitrary
forwarded-host trust without first pinning the public origin.

### Database

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Uses embedded PGlite if not set |
| `POSTGRES_PASSWORD` | Docker Compose Postgres password | `crewcmd` |

### Authentication and API Access

| Variable | Description | Default |
|---|---|---|
| `HEARTBEAT_SECRET` | API token for agent/cron access | — |
| `CREWCMD_RUNTIME_TOKEN_KEYS` | JSON keyring of key ID to base64-encoded 32-byte key | Derived from `AUTH_SECRET` |
| `CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID` | Key ID used for new runtime-token ciphertext | The sole dedicated key, or `auth-secret-v1` |

`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are present in `.env.example` as reserved GitHub OAuth settings, but the default auth provider currently uses email/password credentials only.

Runtime gateway tokens use versioned AES-256-GCM encryption before persistence
and decrypt only at server-side runtime transport boundaries. Production
operators should use a dedicated keyring and follow the
[runtime token encryption and rotation guide](../guides/runtime-token-encryption.md)
before upgrading an installation that already contains runtime tokens.

### AI Providers

Provider API keys are configured in the CrewCmd UI under Settings > Provider Keys. No environment variables needed.

### Optional

| Variable | Description | Default |
|---|---|---|
| `APP_PORT` | Docker Compose app port | `3000` |
| `POSTGRES_PORT` | Docker Compose Postgres host port | `5432` |
| `OPENCLAW_GATEWAY_URL` | Optional OpenClaw gateway URL | — |
| `NEXT_PUBLIC_CREWCMD_REALTIME_VOICE` | Opt in to OpenClaw Talk realtime voice (`1` enables it) | `0` |
| `BLOB_READ_WRITE_TOKEN` | Optional Vercel Blob token for uploaded assets | — |
| `NODE_ENV` | `development` or `production` | `development` |

### Realtime Voice

Realtime voice is an opt-in browser capability. Set
`NEXT_PUBLIC_CREWCMD_REALTIME_VOICE=1` before starting development or building
a deployment. Because Next.js embeds `NEXT_PUBLIC_*` variables in the client
bundle, restart `pnpm dev` after changing the flag and rebuild production or
Docker images.

The selected OpenClaw runtime must expose a configured realtime provider from
the secret-free `talk.catalog` RPC with `gateway-relay` transport. CrewCMD uses
OpenClaw's runtime-selected provider and aliases instead of maintaining a local
provider priority list. OpenClaw 2026.7.1 and newer exposes authoritative
`realtime.ready`; the compatible 2026.6.11 shape is shown as ready but
protocol-unverified until the session-create probe succeeds.

Configure OpenClaw itself with a `talk.realtime` provider, `mode: "realtime"`,
`transport: "gateway-relay"`, and `brain: "agent-consult"`. Provider API keys
belong in OpenClaw configuration or SecretRefs and are never returned by the
CrewCMD readiness endpoint. Verify the safe catalog from the gateway host:

```bash
openclaw gateway call talk.catalog --params '{}' --json
```

The voice UI exposes these readiness states before starting realtime capture:

- `disabled`: enable the CrewCMD build flag and rebuild/restart.
- `provider-missing`: configure or select a ready OpenClaw realtime provider.
- `unsupported-transport`: the provider does not expose `gateway-relay`.
- `unreachable`: check the selected runtime URL, gateway service, and pairing.
- `microphone-denied`: allow microphone permission for the CrewCMD origin.
- `ready`: the selected provider can start a CrewCMD gateway-relay session.

For browser microphone access, use `localhost` or a trusted HTTPS origin.
When realtime is unavailable, CrewCMD explicitly falls back to its classic
recorded STT/TTS path if that path is configured. See the
[OpenClaw Talk protocol documentation](https://docs.openclaw.ai/nodes/talk)
for provider-specific configuration.

## PGlite (Embedded Postgres)

When no `DATABASE_URL` is set, CrewCmd runs an embedded Postgres instance using PGlite. Data is stored locally in `.pglite/`. This is great for:

- Local development
- Single-user self-hosting
- Trying CrewCmd without any infrastructure

For production or multi-user deployments, use an external Postgres instance.
