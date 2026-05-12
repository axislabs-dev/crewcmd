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

/**
 * Write serialization queue for PGlite.
 * PGlite only allows a single write operation at a time. Concurrent writes
 * (e.g. from gateway health/tick events) cause "Another write batch or
 * compaction is already active" errors. This queue serializes all operations.
 */
class WriteQueue {
  private queue: Array<{ run: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  private running = false;

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.flush();
    });
  }

  private async flush() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const result = await item.run();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
    this.running = false;
  }
}

const writeQueue = new WriteQueue();

/** Proxied PGlite client that serializes all operations through a queue */
const queuedClient = new Proxy(client, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function") return value;

    // Wrap methods that perform DB operations
    if (prop === "query" || prop === "exec" || prop === "transaction") {
      return (...args: unknown[]) => writeQueue.enqueue(() => (value as Function).apply(target, args));
    }
    return value.bind(target);
  },
});

const pgliteDb = drizzle(queuedClient as PGlite, { schema });

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
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
    `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS gateway_session_key TEXT`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_company_id UUID`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
    `ALTER TABLE company_runtimes ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'company'`,
    `ALTER TABLE company_runtimes ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
    `ALTER TABLE company_runtimes ADD COLUMN IF NOT EXISTS owner_company_id UUID`,
    `UPDATE company_runtimes SET owner_company_id = company_id WHERE owner_company_id IS NULL`,
  ];
  for (const stmt of incrementalAlters) {
    try {
      await queuedClient.exec(stmt);
    } catch {
      // Safe to ignore — column may already exist
    }
  }

  // System settings table (zero-config startup)
  try {
    await queuedClient.exec(`
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
    await queuedClient.exec(`
      DO $$ BEGIN
        CREATE TYPE chat_message_role AS ENUM ('user', 'assistant', 'system');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        title TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        chat_message_role chat_message_role NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS chat_message_pins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID,
        workspace_id UUID,
        session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        message_id UUID NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
        pinned_by_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queuedClient.exec(`
      DO $$ BEGIN
        CREATE TYPE saved_item_status AS ENUM ('in_progress', 'archived', 'completed');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queuedClient.exec(`
      DO $$ BEGIN
        CREATE TYPE saved_item_source_type AS ENUM ('chat_message', 'task', 'approval', 'doc', 'run');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS saved_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        company_id UUID,
        workspace_id UUID,
        source_type saved_item_source_type NOT NULL,
        source_id TEXT NOT NULL,
        status saved_item_status NOT NULL DEFAULT 'in_progress',
        title TEXT,
        note TEXT,
        reminder_at TIMESTAMPTZ,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, source_type, source_id)
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
      await queuedClient.exec(stmt);
    } catch {
      // Safe to ignore — table may already exist
    }
  }

  // Model management tables
  const modelManagementTables = [
    `CREATE TABLE IF NOT EXISTS model_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_type TEXT NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      owner_company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      profile_key TEXT,
      provider_preferences JSONB DEFAULT '[]'::jsonb,
      primary_model TEXT,
      fallback_models JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT model_profiles_owner_scope_check CHECK (
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_company_id IS NULL)
        OR (owner_type = 'company' AND owner_company_id IS NOT NULL AND owner_user_id IS NULL)
      )
    )`,
    `CREATE TABLE IF NOT EXISTS company_model_defaults (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      model_profile_id UUID REFERENCES model_profiles(id) ON DELETE CASCADE,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT company_model_defaults_choice_check CHECK (
        (model_profile_id IS NOT NULL AND model IS NULL)
        OR (model_profile_id IS NULL AND model IS NOT NULL)
      )
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS model_profiles_user_slug_idx ON model_profiles (owner_type, owner_user_id, slug) WHERE owner_type = 'user'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS model_profiles_company_slug_idx ON model_profiles (owner_type, owner_company_id, slug) WHERE owner_type = 'company'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS company_model_defaults_company_idx ON company_model_defaults (company_id)`,
  ];
  for (const stmt of modelManagementTables) {
    try {
      await queuedClient.exec(stmt);
    } catch {
      // Safe to ignore — table or index may already exist
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
      await queuedClient.exec(stmt);
    } catch {
      // Safe to ignore — table may already exist
    }
  }

  // Inbox Messages table
  try {
    await queuedClient.exec(`
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
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS company_runtimes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        owner_type TEXT NOT NULL DEFAULT 'company',
        owner_user_id UUID,
        owner_company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
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

  // Mobile push and chat run tracking tables
  try {
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS mobile_push_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        provider TEXT NOT NULL,
        token TEXT NOT NULL,
        device_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, company_id, device_id, app_id)
      )
    `);
    await queuedClient.exec(`
      CREATE TABLE IF NOT EXISTS chat_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        gateway_session_key TEXT,
        gateway_run_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        client_visibility TEXT NOT NULL DEFAULT 'visible',
        notify_on_completion BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      )
    `);
    await queuedClient.exec(`CREATE INDEX IF NOT EXISTS mobile_push_devices_user_company_idx ON mobile_push_devices(user_id, company_id)`);
    await queuedClient.exec(`CREATE INDEX IF NOT EXISTS chat_runs_user_status_idx ON chat_runs(user_id, status)`);
  } catch { /* tables may already exist */ }

  // Agent Access Grants table
  try {
    await queuedClient.exec(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'team'`);
    await queuedClient.exec(`
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
      await queuedClient.exec(stmt);
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
      await queuedClient.exec(stmt);
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
