---
title: Zero-Config Startup
description: How CrewCmd achieves a zero-configuration development experience.
---

CrewCmd is designed so that `pnpm install && pnpm dev` just works — no `.env.local` file, no database setup, no manual configuration.

## How It Works

On startup, CrewCmd's instrumentation module runs a bootstrap sequence:

1. **Initialize database** — If no `DATABASE_URL` is set, PGlite (embedded Postgres) starts automatically
2. **Check for `AUTH_SECRET`** — If not set as an env var, generate a random secret and store it in `system_settings`
3. **Check for `HEARTBEAT_SECRET`** — Same auto-generation pattern
4. **Set `process.env`** — Inject DB-stored values into the runtime environment

### Priority Order

Environment variables always take precedence over DB-stored values:

```
Explicit env var  →  DB-stored value  →  Auto-generated default
```

This means production operators can still set env vars traditionally. Auto-generation only activates when values are not set.

## System Settings Table

Auto-generated configuration is persisted in the `system_settings` table:

| Key | Purpose |
|-----|---------|
| `auth_secret` | Auth.js session signing key |
| `heartbeat_secret` | Heartbeat API authentication |

## Exposing the Heartbeat Secret

The `HEARTBEAT_SECRET` is available in **Settings > API Access** (admin-only):
- Masked by default for security
- Can be revealed and copied
- Can be regenerated (invalidates existing tokens)

This allows external systems (cron jobs, CI pipelines) to trigger agent heartbeats via the API.

## Text-to-Speech Fallback

CrewCmd uses the browser's native `speechSynthesis` API by default for voice features. OpenAI TTS is available as an optional upgrade when provider keys are configured.
