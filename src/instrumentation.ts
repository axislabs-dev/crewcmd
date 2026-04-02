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
    // Neon production mode
    const { db } = await import("./db");
    if (db) await ensureSystemSettings(db);
  }
}
