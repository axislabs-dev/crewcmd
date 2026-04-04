import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { systemSettings } from "@/db/schema";

const DEFAULTS: Record<string, () => string> = {
  auth_secret: () => crypto.randomBytes(32).toString("base64"),
  heartbeat_secret: () => crypto.randomBytes(32).toString("hex"),
};

const HEARTBEAT_SECRET_DIR = path.join(os.homedir(), ".crewcmd");
const HEARTBEAT_SECRET_PATH = path.join(HEARTBEAT_SECRET_DIR, "heartbeat-secret");

/**
 * Write heartbeat secret to ~/.crewcmd/heartbeat-secret for zero-config
 * local discovery by OpenClaw agents on the same machine.
 */
export function writeHeartbeatSecretFile(secret: string): void {
  try {
    fs.mkdirSync(HEARTBEAT_SECRET_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(HEARTBEAT_SECRET_PATH, secret, { mode: 0o600 });
  } catch {
    // Non-fatal: file write is best-effort for local discovery
  }
}

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
      if (key === "heartbeat_secret") writeHeartbeatSecretFile(existing[0].value);
    } else {
      const value = generate();
      await db.insert(systemSettings).values({ key, value });
      process.env[envKey] = value;
      if (key === "heartbeat_secret") writeHeartbeatSecretFile(value);
    }
  }
}
