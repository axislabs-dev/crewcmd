import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Database connection factory.
 *
 * Three modes:
 * 1. Neon serverless — DATABASE_URL contains "neon.tech" (HTTP driver)
 * 2. Standard Postgres — DATABASE_URL set but not Neon (postgres.js driver)
 * 3. PGlite — no DATABASE_URL (in-browser, set by instrumentation.ts)
 *
 * All modes return the same Drizzle type so consuming code works uniformly.
 */

// Canonical DB type — all adapters cast to this
type NeonDb = ReturnType<typeof drizzleNeon<typeof schema>>;

function isNeonUrl(url: string): boolean {
  return url.includes("neon.tech") || url.includes("neon.") || !!process.env.USE_NEON_DRIVER;
}

function createNeonDb(): NeonDb {
  const sql = neon(process.env.DATABASE_URL!, {
    fetchOptions: { cache: "no-store" },
  });
  console.log("[CrewCmd] Using Neon (serverless HTTP)");
  return drizzleNeon(sql, { schema });
}

function createPostgresDb(): NeonDb {
  // Dynamic require to avoid bundling postgres.js when using Neon/PGlite
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("postgres");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/postgres-js");

  const client = pg(process.env.DATABASE_URL!);
  console.log("[CrewCmd] Using Postgres (standard)");
  return drizzle(client, { schema }) as NeonDb;
}

/**
 * Lazily resolves the PGlite db instance set by instrumentation.ts.
 * Returns null in Edge Runtime or if instrumentation hasn't run yet.
 */
function getPgliteDb(): NeonDb | null {
  return ((globalThis as Record<string, unknown>).__crewcmd_db as NeonDb) ?? null;
}

function initDb(): NeonDb | null {
  if (process.env.DATABASE_URL) {
    return isNeonUrl(process.env.DATABASE_URL) ? createNeonDb() : createPostgresDb();
  }
  // In PGlite mode, return a Proxy that lazily resolves to the PGlite db
  // set by instrumentation.ts. This avoids importing Node.js-only code
  // in the Edge Runtime bundle.
  return new Proxy({} as NeonDb, {
    get(_, prop) {
      const resolved = getPgliteDb();
      if (!resolved) return undefined;
      const value = (resolved as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as Function).bind(resolved) : value;
    },
  });
}

export const db = initDb();

/**
 * Retry wrapper for DB queries — handles cold start timeouts and connection errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ETIMEDOUT") ||
          error.message.includes("ECONNREFUSED"));
      if (!isRetryable || attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry exhausted");
}
