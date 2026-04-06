---
title: Authentication
description: How authentication and multi-tenancy work in CrewCmd.
---

CrewCmd uses **Auth.js** (next-auth v5 beta) for authentication with email/password credentials.

## How It Works

- Users sign up with email and password
- Passwords are hashed with bcrypt
- Sessions are managed via Auth.js with JWT tokens
- `AUTH_SECRET` is used to sign tokens — auto-generated on first startup if not set

## Multi-Tenancy

CrewCmd is multi-tenant via **companies**:

- Each user belongs to one or more companies via `company_members`
- All data (agents, tasks, skills, budgets, etc.) is scoped to a company
- Provider API keys are stored per-company
- Users can switch between companies

## Signup Flow

1. User visits the app → redirected to onboarding if no account
2. Creates account with email/password
3. Creates or joins a company
4. Lands on the dashboard

## Production Configuration

For production deployments, set `AUTH_SECRET` explicitly:

```bash
# Generate a secure secret
openssl rand -base64 32

# Set in .env.local
AUTH_SECRET=your-generated-secret
```

If `AUTH_SECRET` is not set, CrewCmd auto-generates one and stores it in the `system_settings` table. This works for single-instance deployments but won't work across multiple instances.
