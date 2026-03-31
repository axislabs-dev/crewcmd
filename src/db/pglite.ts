import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "fs";
import path from "path";
import * as schema from "./schema";

const dataDir = path.join(process.cwd(), ".data", "pglite");
const migrationsFolder = path.join(process.cwd(), "drizzle");

// Ensure the data directory exists before PGlite tries to use it
mkdirSync(dataDir, { recursive: true });

const pgliteDb = drizzle({
  connection: { dataDir },
  schema,
});

// Run migrations eagerly — PGlite driver queues queries until ready,
// and migrate() will execute before any user query since it's enqueued first.
export const migrationPromise = migrate(pgliteDb, { migrationsFolder })
  .then(() => {
    console.log("[CrewCmd] Using PGlite (local) — data at .data/pglite");
  })
  .catch((err) => {
    console.error("[CrewCmd] PGlite migration failed:", err);
  });

export { pgliteDb };
