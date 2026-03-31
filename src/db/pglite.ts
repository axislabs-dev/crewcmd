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
  ];
  for (const stmt of incrementalAlters) {
    try {
      await client.exec(stmt);
    } catch {
      // Safe to ignore — column may already exist
    }
  }

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
