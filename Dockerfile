# ── CrewCmd Dockerfile ────────────────────────────────────────────
# Multi-stage build for minimal production image.
#
# Build:  docker build -t crewcmd .
# Run:    docker run -p 3000:3000 crewcmd
# ──────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# ── Build ────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js standalone output — bundles everything into .next/standalone
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_OUTPUT=standalone

# Auth secret required at build time for next-auth; overridden at runtime
ARG AUTH_SECRET=build-placeholder
ENV AUTH_SECRET=${AUTH_SECRET}

RUN pnpm build

# ── Production ───────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build + static/public assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Drizzle migrations for the entrypoint to run
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/package.json ./package.json

# PGlite data directory (used when DATABASE_URL is not set)
RUN mkdir -p .data/pglite && chown -R nextjs:nodejs .data

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
