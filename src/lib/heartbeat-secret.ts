import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { systemSettings } from "@/db/schema";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let cachedHeartbeatSecrets: string[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000;
const HEARTBEAT_SECRET_PATH = path.join(os.homedir(), ".crewcmd", "heartbeat-secret");

function addSecretCandidate(candidates: string[], value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
}

export async function getHeartbeatSecrets(): Promise<string[]> {
  const now = Date.now();
  if (cachedHeartbeatSecrets && now - cachedAt < CACHE_TTL_MS) {
    return cachedHeartbeatSecrets;
  }

  const candidates: string[] = [];

  if (db) {
    const [row] = await withRetry(() =>
      db!
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, "heartbeat_secret"))
        .limit(1)
    );
    addSecretCandidate(candidates, row?.value);
  }

  addSecretCandidate(candidates, process.env.HEARTBEAT_SECRET);

  try {
    addSecretCandidate(candidates, await readFile(HEARTBEAT_SECRET_PATH, "utf8"));
  } catch {
    // Optional zero-config local discovery file may not exist in hosted deployments.
  }

  cachedHeartbeatSecrets = candidates;
  cachedAt = now;
  return cachedHeartbeatSecrets;
}

export async function getHeartbeatSecret(): Promise<string | null> {
  return (await getHeartbeatSecrets())[0] ?? null;
}

export async function hasHeartbeatSecret(): Promise<boolean> {
  return (await getHeartbeatSecrets()).length > 0;
}

export async function matchesHeartbeatBearerToken(authHeader: string | null | undefined): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const providedToken = authHeader.slice(7).trim();
  if (!providedToken) return false;
  return (await getHeartbeatSecrets()).includes(providedToken);
}
