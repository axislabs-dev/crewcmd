# Zero-Config Startup Architecture

> Status: Planning Spec
> Created: 2026-04-02
> Author: Neo + Roger (voice session)

## Goal

`pnpm install && pnpm dev` just works. No `.env.local`, no manual secret generation, no config files. Everything is either auto-generated on first run or collected during onboarding.

## Current State

CrewCmd depends on these env vars:

| Env Var | Current Status | Blocks Without It |
|---------|---------------|-------------------|
| `DATABASE_URL` | PGlite fallback exists ✅ | No |
| `AUTH_SECRET` | No fallback ❌ | Yes, NextAuth fails |
| `HEARTBEAT_SECRET` | No fallback ❌ | Yes, API mutations blocked |
| `OPENAI_API_KEY` | Whisper local fallback for STT ✅ | Partial (TTS needs it) |
| `BLOB_READ_WRITE_TOKEN` | Local storage fallback ✅ | No |
| `SLACK_BOT_TOKEN` | Optional ✅ | No |
| `GITHUB_WEBHOOK_SECRET` | Optional ✅ | No |
| `OPENCLAW_GATEWAY_TOKEN` | Reads from openclaw.json ✅ | No |

Only two are true blockers: `AUTH_SECRET` and `HEARTBEAT_SECRET`.

## Design

### System Settings Table

```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Used to persist auto-generated configuration that must survive restarts.

### Startup Flow

```
1. App starts
2. DB initializes (PGlite for local, Postgres for production)
3. Check system_settings for 'auth_secret'
   - Missing? Generate crypto.randomBytes(32).toString('base64'), store it
   - Found? Use it
4. Check system_settings for 'heartbeat_secret'
   - Missing? Generate crypto.randomBytes(32).toString('hex'), store it
   - Found? Use it
5. Set process.env.AUTH_SECRET and process.env.HEARTBEAT_SECRET from DB values
6. Continue normal startup
```

**Env vars always take precedence.** If someone sets `AUTH_SECRET` in `.env.local` or their hosting platform, that overrides the DB value. This supports production deployments where env vars are the standard.

### Implementation

```typescript
// src/lib/system-settings.ts

import crypto from "node:crypto";

const DEFAULTS: Record<string, () => string> = {
  auth_secret: () => crypto.randomBytes(32).toString("base64"),
  heartbeat_secret: () => crypto.randomBytes(32).toString("hex"),
};

export async function ensureSystemSettings(db: Database): Promise<void> {
  for (const [key, generate] of Object.entries(DEFAULTS)) {
    const envKey = key.toUpperCase(); // AUTH_SECRET, HEARTBEAT_SECRET

    // Env var takes precedence
    if (process.env[envKey]) continue;

    // Check DB
    const existing = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);

    if (existing.length > 0) {
      process.env[envKey] = existing[0].value;
    } else {
      const value = generate();
      await db.insert(systemSettings).values({ key, value });
      process.env[envKey] = value;
    }
  }
}
```

Called from `instrumentation.ts` during app startup, before NextAuth or any API route initializes.

### Token Exposure in Admin Settings

The auto-generated HEARTBEAT_SECRET is exposed in the admin UI under Settings > API Access:

- **View:** Masked by default, click to reveal (admin/owner only)
- **Regenerate:** Creates new token, invalidates old one
- **Copy:** For configuring external systems that need to call CrewCmd's API
- **Label:** "CrewCmd API Token" (not "heartbeat secret" — user-friendly naming)

Regular team members do not see this section.

### What Users Interact With

| Token | Created By | User Sees It? | Where |
|-------|-----------|---------------|-------|
| AUTH_SECRET | Auto-generated | Never | Internal NextAuth signing |
| HEARTBEAT_SECRET | Auto-generated | Admin only | Settings > API Access |
| OpenClaw Gateway Token | OpenClaw | Yes, during onboarding | Onboarding > Connect Runtime |

### TTS Fallback (Bonus)

To eliminate the `OPENAI_API_KEY` dependency for basic voice:

1. Use browser-native `speechSynthesis` API as default TTS
2. Offer OpenAI TTS as upgrade in Settings > Voice
3. When OpenAI key is configured (via credential vault), use higher-quality voices

This makes voice-first work out of the box with zero API keys.

## Changes Required

### 1. New table: `system_settings`
Add to schema.ts and create migration.

### 2. New module: `src/lib/system-settings.ts`
Auto-generation and loading logic.

### 3. Update `instrumentation.ts`
Call `ensureSystemSettings()` before other initialization.

### 4. Update `src/lib/require-auth.ts`
No changes needed — it already reads `process.env.HEARTBEAT_SECRET`.

### 5. Settings UI: API Access section
New component under Settings for admin token management.

### 6. TTS fallback
Update `src/app/api/tts/route.ts` to support browser-native fallback.

## Production Deployment

For production (Vercel, Railway, etc.), operators can still set env vars the traditional way. The auto-generation only activates when the env var is not set. This means:

- **Local dev:** Zero config, auto-generated, stored in PGlite
- **Staging/Production:** Set `AUTH_SECRET` and `DATABASE_URL` in hosting platform as normal
- **HEARTBEAT_SECRET** in production: auto-generated and stored in Postgres, or set via env var

No breaking changes to existing deployments.
