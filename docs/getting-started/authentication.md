# Authentication

CrewCmd uses session authentication for normal users and scoped runtime bearer
authentication for selected runtime callbacks.

## Local Auth (Default)

Works out of the box. First user to sign up becomes the admin.

1. Open CrewCmd and click "Sign Up"
2. Create your account with email and password
3. You're in. First account gets admin access automatically.

## GitHub OAuth Status

GitHub OAuth environment variables are reserved in `.env.example`, but the current default auth provider only enables email/password credentials. Do not expect GitHub login to appear unless a future change wires the provider into `src/lib/auth.ts`.

## API Authentication

For dashboard and generic API access, sign in and use the session cookie issued
by NextAuth. Generic endpoints do not accept `HEARTBEAT_SECRET` as a universal
API key.

### Runtime Bearer Token

Runtime bearer auth is for endpoints that explicitly support runtime heartbeat
access. Set `HEARTBEAT_SECRET`, then send it with the runtime id and an explicit
workspace or company scope:

```bash
curl \
  -H "Authorization: Bearer $HEARTBEAT_SECRET" \
  -H "X-CrewCMD-Runtime-Id: $RUNTIME_ID" \
  "http://localhost:3000/api/tasks?workspaceId=$WORKSPACE_ID"
```

Runtime bearer calls are scoped to the workspace owned by the runtime. When a
runtime-enabled endpoint reads or writes workspace data, include `workspaceId`
or `companyId` in the query string or request body.

### Public Endpoints

These endpoints don't require authentication:

- `GET /api/health` — Health check

All other endpoints require either a signed-in session or explicit runtime
bearer support documented by the route.
