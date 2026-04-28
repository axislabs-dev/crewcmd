# Self-Hosting

CrewCmd is designed to be self-hosted. Your data stays on your infrastructure.

## Deployment Options

### 1. Local Machine (Development)

```bash
pnpm dev:https
```

Uses embedded PGlite. No external services needed.

### 2. Docker Compose (Recommended for Production)

```bash
cp .env.example .env
# Edit .env and set AUTH_SECRET before exposing this service.
docker compose up -d
```

Includes Postgres and CrewCmd. Put it behind your own reverse proxy or platform TLS layer for public access.

### 3. VPS / Cloud VM

1. Clone the repo on your server
2. Set up Postgres (or use embedded PGlite for single-user)
3. Configure environment variables
4. Run with `pnpm start` or use PM2/systemd

### 4. Platform Deploy

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

Data is stored in `.pglite/`. Back up this directory:

```bash
cp -r .pglite .pglite-backup-$(date +%Y%m%d)
```

### External Postgres

Use standard `pg_dump`:

```bash
pg_dump $DATABASE_URL > crewcmd-backup-$(date +%Y%m%d).sql
```

## Updating

```bash
git pull origin main
pnpm install
pnpm db:push  # Apply any schema changes
pnpm build
# Restart the server
```
