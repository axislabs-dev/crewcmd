# Authentication

CrewCmd supports multiple authentication methods.

## Local Auth (Default)

Works out of the box. First user to sign up becomes the admin.

1. Open CrewCmd and click "Sign Up"
2. Create your account with email and password
3. You're in. First account gets admin access automatically.

## GitHub OAuth Status

GitHub OAuth environment variables are reserved in `.env.example`, but the current default auth provider only enables email/password credentials. Do not expect GitHub login to appear unless a future change wires the provider into `src/lib/auth.ts`.

## API Authentication

For programmatic access (agents, cron jobs, integrations):

### Bearer Token

Set `HEARTBEAT_SECRET` in your environment, then use it as a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_SECRET" https://localhost:3000/api/tasks
```

### Public Endpoints

These endpoints don't require authentication:

- `GET /api/health` — Health check
- `GET /api/agents` — List agents (read-only)
- `GET /api/tasks` — List tasks (read-only)
- `GET /api/projects` — List projects (read-only)

All write operations (POST, PATCH, DELETE) require authentication.
