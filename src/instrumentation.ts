export async function register() {
  // PGlite local dev mode — only in Node.js runtime, when no DATABASE_URL
  if (!process.env.DATABASE_URL && process.env.NEXT_RUNTIME === "nodejs") {
    const { pgliteDb, migrationPromise } = await import("./db/pglite");
    await migrationPromise;
    (globalThis as Record<string, unknown>).__crewcmd_db = pgliteDb;
  }
}
