# Self-Hosting

CrewCmd is designed to be self-hosted. The current supported contract is a
source checkout with embedded PGlite for contributor evaluation and controlled
OSS preview use. This is not yet a hardened production support guarantee.

Docker Compose, external Postgres, and platform deployments remain preview
paths pending the manual evidence in
[#668](https://github.com/rogerchappel/crewcmd/issues/668). There is currently
no supported npm CLI, desktop installer, prebuilt server archive, or published
container image.

## Deployment Options

### 1. Source Checkout + Embedded PGlite (Supported Preview Path)

```bash
git clone https://github.com/rogerchappel/crewcmd.git
cd crewcmd
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Use `pnpm dev:https` only for HTTPS-only browser
features or local-network testing. PGlite data is stored in `.data/pglite`.

### 2. Docker Compose + Postgres (Preview)

```bash
cp .env.example .env
# Edit .env and set AUTH_SECRET before exposing this service.
docker compose up --build -d
curl --fail http://localhost:3000/api/health
```

This includes Postgres and CrewCmd. Validate restart persistence, backup,
restore, TLS, and teardown on the target host before relying on it.

### 3. VPS / Cloud VM (Preview)

1. Clone the repo on your server
2. Set up Postgres (or use embedded PGlite for single-user)
3. Configure environment variables
4. Run with `pnpm start` or use PM2/systemd

### 4. Platform Deploy (Uncertified)

CrewCmd is a Next.js app. Deploy to:

- **Vercel** — Needs external Postgres (Neon, Supabase)
- **Railway** — Includes Postgres
- **Fly.io** — Includes Postgres
- **Coolify** — Self-hosted PaaS

## HTTPS

HTTPS is required for:

- Voice features (microphone access)
- Secure cookie handling

For local development, `pnpm dev:https` generates a self-signed certificate.

For production, use a reverse proxy (Nginx, Caddy) with Let's Encrypt, or deploy behind a platform that handles TLS.

## Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name crewcmd.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/crewcmd.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crewcmd.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Backups

### PGlite (Embedded)

Data is stored in `.data/pglite/`. Stop CrewCmd completely, then create a
PGlite archive:

```bash
pnpm db:pglite:backup -- \
  "./backups/crewcmd-pglite-$(date +%Y%m%d-%H%M%S).tar.gz"
```

The backup command refuses to run while the embedded database appears active
and refuses to overwrite an existing archive. Archives contain account data,
password hashes, runtime configuration, and any secrets stored in the
database. They are created with owner-only permissions, but should still be
encrypted and access-controlled wherever they are retained.

Raw copies of `.data/pglite` are not a supported recovery format. Restore an
archive into a new, empty data directory with the same reviewed CrewCmd/PGlite
version that created it:

```bash
export CREWCMD_PGLITE_DATA_DIR=.data/pglite-restored
pnpm db:pglite:restore -- ./backups/crewcmd-pglite-YYYYMMDD-HHMMSS.tar.gz
pnpm dev
```

The restore command never deletes or overwrites a non-empty target directory.
Confirm `/api/health`, sign in, and exercise one read/write workflow before
making the restored directory your normal `CREWCMD_PGLITE_DATA_DIR`.

### External Postgres

Use standard `pg_dump`:

```bash
pg_dump $DATABASE_URL > crewcmd-backup-$(date +%Y%m%d).sql
```

For Docker Compose:

```bash
docker compose exec -T db pg_dump -U crewcmd crewcmd > crewcmd-backup-$(date +%Y%m%d).sql
```

Test restoring backups in a disposable environment before depending on them.

## Updating

There are no published stable release artifacts yet. Pin deployments to a
reviewed commit SHA, record the current SHA, and take a matching data backup
before updating.

```bash
git rev-parse HEAD
# Stop CrewCmd, then archive the current embedded database if applicable.
pnpm db:pglite:backup -- ./backups/crewcmd-pglite-before-update.tar.gz
git fetch origin
git checkout REVIEWED_COMMIT_OR_TAG
pnpm install --frozen-lockfile
pnpm build
# Restart the server
```

Embedded PGlite applies its tracked schema at startup. External Postgres users
must back up the database and run `pnpm db:migrate` before restarting.

## Rollback

There is no automated downgrade workflow. To roll back safely:

1. Stop CrewCmd.
2. Check out the previously recorded commit SHA.
3. Restore the data backup taken for that exact code revision if the update
   applied schema changes.
4. Run `pnpm install --frozen-lockfile`, rebuild, and restart.
5. Confirm `/api/health`, sign-in, and one read/write workflow before reopening
   access.

Do not run older code against a newer migrated database without a tested
compatibility or restore plan.

For migration diagnostics and baselining an older database, see [Database Migrations](database-migrations.md).
