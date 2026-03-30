import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const sql = neon(process.env.DATABASE_URL, {
    fetchOptions: { cache: "no-store" },
  });
  return drizzle(sql, { schema });
}

export const db = process.env.DATABASE_URL ? getDb() : null;

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
