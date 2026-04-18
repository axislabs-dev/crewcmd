import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { systemSettings } from "@/db/schema";

let cachedHeartbeatSecret: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000;

export async function getHeartbeatSecret(): Promise<string | null> {
  const envSecret = process.env.HEARTBEAT_SECRET?.trim();
  if (envSecret) return envSecret;

  if (!db) return null;

  const now = Date.now();
  if (cachedHeartbeatSecret && now - cachedAt < CACHE_TTL_MS) {
    return cachedHeartbeatSecret;
  }

  const [row] = await withRetry(() =>
    db!
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, "heartbeat_secret"))
      .limit(1)
  );

  cachedHeartbeatSecret = row?.value?.trim() ?? null;
  cachedAt = now;
  return cachedHeartbeatSecret;
}

export async function hasHeartbeatSecret(): Promise<boolean> {
  return !!(await getHeartbeatSecret());
}

export async function matchesHeartbeatBearerToken(authHeader: string | null | undefined): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const expectedToken = await getHeartbeatSecret();
  if (!expectedToken) return false;
  return authHeader === `Bearer ${expectedToken}`;
}
