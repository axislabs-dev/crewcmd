/**
 * Gateway Chat Connection Pool
 *
 * Maintains one WebSocket connection per runtime, reused across chat requests.
 * Connections are recycled after 5 minutes to avoid stale state.
 */

import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";

interface PoolEntry {
  client: GatewayClient;
  connectedAt: number;
}

const pool = new Map<string, PoolEntry>();

const MAX_CONNECTION_AGE_MS = 300_000; // 5 minutes

export async function getGatewayClient(): Promise<GatewayClient> {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const runtime = await withRetry(() =>
    db!.query.companyRuntimes.findFirst({
      where: eq(companyRuntimes.isPrimary, true),
    })
  );

  if (!runtime) {
    throw new Error("No runtime configured");
  }

  if (!runtime.gatewayUrl) {
    throw new Error("Runtime has no gateway URL configured");
  }

  console.log("[gateway-pool] Runtime:", runtime.id, "URL:", runtime.gatewayUrl, "hasToken:", !!runtime.authToken);

  const key = runtime.id;
  const existing = pool.get(key);

  // Reuse if connected and less than 5 min old
  if (existing && existing.client.isConnected && (Date.now() - existing.connectedAt < MAX_CONNECTION_AGE_MS)) {
    return existing.client;
  }

  // Close stale connection
  if (existing) {
    existing.client.close();
    pool.delete(key);
  }

  // Create new connection with device key from runtime metadata
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const device = resolveDeviceIdentity(deviceKeyPem);
  console.log("[gateway-pool] Device source:", device.source, "hasStoredKey:", !!deviceKeyPem);

  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    device,
    30000 // 30s timeout for chat
  );

  try {
    await client.connect();
    console.log("[gateway-pool] Connected successfully");
  } catch (err) {
    console.error("[gateway-pool] Connection failed:", err instanceof Error ? err.message : err);
    throw err;
  }
  pool.set(key, { client, connectedAt: Date.now() });

  return client;
}
