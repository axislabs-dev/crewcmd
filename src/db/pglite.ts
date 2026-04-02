import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mkdirSync, readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import * as schema from "./schema";

const dataDir = path.join(process.cwd(), ".data", "pglite");
const markerFile = path.join(dataDir, ".schema-applied");

// Ensure the data directory exists
mkdirSync(dataDir, { recursive: true });

const client = new PGlite(dataDir);

const pgliteDb = drizzle(client, { schema });

/**
 * Apply full schema from schema.ts via raw SQL generated from all migration files.
 * Since migration 0000 is a no-op baseline, we use drizzle-kit push equivalent:
 * execute all CREATE statements from schema directly on first run.
 */
async function applySchema() {
  // Always run incremental migrations for new columns
  const incrementalAlters = [
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS adapter_type text NOT NULL DEFAULT 'openclaw_gateway'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS adapter_config jsonb DEFAULT '{}'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS role text DEFAULT 'engineer'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS model text`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_path text`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_config JSONB DEFAULT '{}'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS canvas_position JSONB`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_id UUID`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_ref TEXT`,
  ];
  for (const stmt of incrementalAlters) {
    try {
      await client.exec(stmt);
    } catch {
      // Safe to ignore — column may already exist
    }
  }

  // System settings table (zero-config startup)
  try {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch { /* table may already exist */ }

  // Chat persistence tables
  try {
    await client.exec(`
      DO $$ BEGIN
        CREATE TYPE chat_message_role AS ENUM ('user', 'assistant', 'system');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await client.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        title TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        chat_message_role chat_message_role NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch { /* tables may already exist */ }

  // Skills tables
  const skillsTables = [
    `CREATE TABLE IF NOT EXISTS skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL DEFAULT 'custom',
      source_url TEXT,
      source_ref TEXT,
      version TEXT,
      content TEXT,
      metadata JSONB DEFAULT '{}',
      installed BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS agent_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT true,
      config JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];
  for (const stmt of skillsTables) {
    try {
      await client.exec(stmt);
    } catch {
      // Safe to ignore — table may already exist
    }
  }

  // Team Blueprints table
  const blueprintTables = [
    `CREATE TABLE IF NOT EXISTS team_blueprints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      icon TEXT NOT NULL,
      agent_count INTEGER NOT NULL,
      is_built_in BOOLEAN NOT NULL DEFAULT false,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      template JSONB NOT NULL,
      popularity INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];
  for (const stmt of blueprintTables) {
    try {
      await client.exec(stmt);
    } catch {
      // Safe to ignore — table may already exist
    }
  }

  // Inbox Messages table
  try {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        from_agent_id TEXT NOT NULL,
        to_user_id UUID,
        to_agent_id TEXT,
        type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        context JSONB,
        actions JSONB,
        status TEXT NOT NULL DEFAULT 'unread',
        actioned_by TEXT,
        actioned_at TIMESTAMPTZ,
        action_result TEXT,
        snooze_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch { /* table may already exist */ }

  // Company Runtimes table
  try {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS company_runtimes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        runtime_type TEXT NOT NULL DEFAULT 'openclaw',
        name TEXT NOT NULL,
        gateway_url TEXT NOT NULL,
        http_url TEXT NOT NULL,
        auth_token TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'disconnected',
        last_ping TIMESTAMPTZ,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch { /* table may already exist */ }

  // Agent Access Grants table
  try {
    await client.exec(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'team'`);
    await client.exec(`
      CREATE TABLE IF NOT EXISTS agent_access_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by TEXT NOT NULL,
        can_interact BOOLEAN NOT NULL DEFAULT true,
        can_configure BOOLEAN NOT NULL DEFAULT false,
        can_view_logs BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch { /* tables may already exist */ }

  if (existsSync(markerFile)) {
    console.log("[CrewCmd] Using PGlite (local) — data at .data/pglite");
    return;
  }

  console.log("[CrewCmd] PGlite: applying schema from scratch...");

  // Read all migration SQL files in order and extract CREATE statements
  const migrationsDir = path.join(process.cwd(), "drizzle");
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Collect all CREATE TYPE and CREATE TABLE statements across all migrations
  const createStatements: string[] = [];
  const alterStatements: string[] = [];

  for (const file of sqlFiles) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      // Strip leading SQL comments to detect statement type
      const stripped = stmt.replace(/^--.*\n?/gm, "").trim();
      if (stripped.startsWith("CREATE")) {
        createStatements.push(stmt);
      } else if (stripped.startsWith("ALTER") || stripped.startsWith("DO $$")) {
        alterStatements.push(stmt);
      }
    }
  }

  // Execute CREATEs first (types, then tables), then ALTERs
  for (const stmt of createStatements) {
    try {
      await client.exec(stmt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Skip "already exists" errors (idempotent)
      if (!msg.includes("already exists")) {
        console.warn("[CrewCmd] PGlite schema warning:", msg.slice(0, 120));
      }
    }
  }

  for (const stmt of alterStatements) {
    try {
      await client.exec(stmt);
    } catch {
      // Silently ignore ALTER failures — expected on fresh installs
      // when referenced tables/columns don't yet exist
    }
  }

  // Mark schema as applied
  const { writeFileSync } = await import("fs");
  writeFileSync(markerFile, new Date().toISOString());
  console.log("[CrewCmd] Using PGlite (local) — schema applied, data at .data/pglite");
}

export const migrationPromise = applySchema().catch((err) => {
  console.error("[CrewCmd] PGlite schema setup failed:", err);
});

export { pgliteDb };
