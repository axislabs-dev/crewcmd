import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { systemSettings } from "@/db/schema";

const DEFAULTS: Record<string, () => string> = {
  auth_secret: () => crypto.randomBytes(32).toString("base64"),
  heartbeat_secret: () => crypto.randomBytes(32).toString("hex"),
};

/**
 * Ensure AUTH_SECRET and HEARTBEAT_SECRET are available in process.env.
 * Auto-generates and persists them in system_settings on first run.
 * Env vars always take precedence over DB values.
 */
export async function ensureSystemSettings(
  db: { select: Function; insert: Function }
): Promise<void> {
  for (const [key, generate] of Object.entries(DEFAULTS)) {
    const envKey = key.toUpperCase();

    // Env var takes precedence
    if (process.env[envKey]) continue;

    // Check DB
    const existing = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);

    if (existing.length > 0) {
      process.env[envKey] = existing[0].value;
    } else {
      const value = generate();
      await db.insert(systemSettings).values({ key, value });
      process.env[envKey] = value;
    }
  }
}
