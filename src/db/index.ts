import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createNeonDb() {
  const sql = neon(process.env.DATABASE_URL!, {
    fetchOptions: { cache: "no-store" },
  });
  console.log("[CrewCmd] Using Neon (remote)");
  return drizzle(sql, { schema });
}

type NeonDb = ReturnType<typeof createNeonDb>;

/**
 * Lazily resolves the PGlite db instance set by instrumentation.ts.
 * Returns null in Edge Runtime or if instrumentation hasn't run yet.
 */
function getPgliteDb(): NeonDb | null {
  return ((globalThis as Record<string, unknown>).__crewcmd_db as NeonDb) ?? null;
}

function initDb(): NeonDb | null {
  if (process.env.DATABASE_URL) {
    return createNeonDb();
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
 * Retry wrapper for DB queries — handles Neon cold start timeouts.
 * First request after inactivity often times out while Neon wakes up.
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
      const isTimeout =
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ETIMEDOUT"));
      if (!isTimeout || attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry exhausted");
}
