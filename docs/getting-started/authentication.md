# Authentication

CrewCmd supports multiple authentication methods.

## Local Auth (Default)

Works out of the box. First user to sign up becomes the admin.

1. Open CrewCmd and click "Sign Up"
2. Create your account with email and password
3. You're in. First account gets admin access automatically.

## GitHub OAuth

For team use, set up GitHub OAuth:

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) > OAuth Apps > New OAuth App
2. Set the homepage URL to your CrewCmd URL (e.g., `https://localhost:3000`)
3. Set the callback URL to `https://localhost:3000/api/auth/callback/github`
4. Copy the Client ID and Client Secret to your `.env.local`:

```bash
GITHUB_ID=your_client_id
GITHUB_SECRET=your_client_secret
```

5. Restart CrewCmd. GitHub login will appear on the sign-in page.

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
