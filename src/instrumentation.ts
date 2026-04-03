export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureSystemSettings } = await import("./lib/system-settings");

  if (!process.env.DATABASE_URL) {
    // PGlite local dev mode
    const { pgliteDb, migrationPromise } = await import("./db/pglite");
    await migrationPromise;
    (globalThis as Record<string, unknown>).__crewcmd_db = pgliteDb;
    await ensureSystemSettings(pgliteDb);
  } else {
    // Neon or standard Postgres — run Drizzle migrations
    const { db } = await import("./db");
    if (db) {
      await runMigrations();
      await ensureSystemSettings(db);
    }
  }
}

/**
 * Run Drizzle migrations from the /drizzle directory.
 * Uses drizzle-kit migrate under the hood via raw SQL execution.
 */
async function runMigrations() {
  try {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const pg = (await import("postgres")).default;

    const client = pg(process.env.DATABASE_URL!, { max: 1 });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const migrationDb = drizzle(client);

    await migrate(migrationDb, { migrationsFolder: "./drizzle" });
    await client.end();
    console.log("[CrewCmd] Migrations applied successfully");
  } catch (err) {
    // If using Neon HTTP driver, migrations via postgres-js won't work.
    // Neon users should run migrations separately via drizzle-kit push.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("neon") || msg.includes("fetch")) {
      console.log("[CrewCmd] Neon detected — skipping auto-migration (use drizzle-kit push)");
    } else {
      console.warn("[CrewCmd] Migration warning:", msg);
    }
  }
}
