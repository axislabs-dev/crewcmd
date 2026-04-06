---
title: Environment Variables
description: Configure CrewCmd for production deployments.
---

CrewCmd is designed to work out of the box with no configuration for local development. For production deployments, you'll want to set these environment variables.

## Required for Production

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | Neon Postgres connection string. Omit for PGlite dev mode. |
| `AUTH_SECRET` | Auth.js secret for session encryption. Auto-generated if not set. |

## Optional

| Variable | Description |
|----------|------------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token for file uploads. |
| `HEARTBEAT_SECRET` | Secret for authenticating heartbeat API calls. Auto-generated if not set. |

## Provider API Keys

LLM provider API keys (OpenAI, Anthropic, Google, etc.) are **not** stored as environment variables. They are managed per-company in the database through **Settings > Provider Keys**.

This design allows:
- Multi-tenant isolation — each company has its own keys
- Runtime management — add, rotate, or revoke keys without redeployment
- Security — keys are encrypted at rest in the database

See [Authentication](/configuration/authentication/) for more details on auth configuration.
