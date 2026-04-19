/**
 * Gateway Chat Connection Pool
 *
 * Maintains one WebSocket connection per runtime, reused across chat requests.
 * Connections are recycled after 5 minutes to avoid stale state.
 */

import { readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
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
const LOCAL_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

/**
 * Mark a client as "in use" so the pool won't recycle it mid-request.
 * Call release() when done.
 */
const activeClients = new Set<GatewayClient>();

export function holdClient(client: GatewayClient) {
  activeClients.add(client);
}

export function releaseClient(client: GatewayClient) {
  activeClients.delete(client);
}

function toHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of urls) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function readLocalGatewayConfig(): Promise<{ port: number; bind: string } | null> {
  try {
    const raw = await readFile(LOCAL_OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      gateway?: { port?: number; bind?: string };
    };
    const port = parsed.gateway?.port;
    if (!port || !Number.isFinite(port)) {
      return null;
    }
    return {
      port,
      bind: parsed.gateway?.bind || "loopback",
    };
  } catch {
    return null;
  }
}

function getLocalIpv4Hosts(): string[] {
  const interfaces = networkInterfaces();
  const hosts: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      hosts.push(entry.address);
    }
  }

  return hosts;
}

async function buildGatewayCandidates(storedGatewayUrl: string): Promise<string[]> {
  const localConfig = await readLocalGatewayConfig();
  if (!localConfig) {
    return [storedGatewayUrl];
  }

  let stored: URL;
  try {
    stored = new URL(storedGatewayUrl);
  } catch {
    return [storedGatewayUrl];
  }

  const protocol = stored.protocol === "wss:" ? "wss:" : "ws:";
  const port = localConfig.port || Number(stored.port) || 18789;
  const candidates = [storedGatewayUrl];

  // Same-machine runtimes should still be reachable on loopback after DHCP changes.
  // When Tailscale is up, its 100.x address will also appear in the local IPv4 list.
  candidates.push(`${protocol}//127.0.0.1:${port}`);
  candidates.push(`${protocol}//localhost:${port}`);

  if (localConfig.bind === "lan") {
    for (const host of getLocalIpv4Hosts()) {
      candidates.push(`${protocol}//${host}:${port}`);
    }
  }

  return uniqueUrls(candidates);
}

async function repairRuntimeUrl(params: {
  runtimeId: string;
  gatewayUrl: string;
}) {
  await withRetry(() =>
    db!.update(companyRuntimes)
      .set({
        gatewayUrl: params.gatewayUrl,
        httpUrl: toHttpUrl(params.gatewayUrl),
        status: "connected",
        lastPing: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companyRuntimes.id, params.runtimeId))
  );
}

async function connectWithFallback(params: {
  runtimeId: string;
  storedGatewayUrl: string;
  authToken: string | null;
  deviceKeyPem?: string;
}): Promise<{ client: GatewayClient; connectedUrl: string }> {
  const device = resolveDeviceIdentity(params.deviceKeyPem);
  console.log("[gateway-pool] Device source:", device.source, "hasStoredKey:", !!params.deviceKeyPem);

  const candidates = await buildGatewayCandidates(params.storedGatewayUrl);
  let lastError: unknown = null;

  for (const url of candidates) {
    const client = new GatewayClient(
      url,
      params.authToken,
      device,
      30000 // 30s timeout for chat
    );

    try {
      if (url !== params.storedGatewayUrl) {
        console.warn("[gateway-pool] Retrying runtime via fallback URL:", url);
      }
      await client.connect();
      if (url !== params.storedGatewayUrl) {
        await repairRuntimeUrl({
          runtimeId: params.runtimeId,
          gatewayUrl: url,
        });
        console.warn("[gateway-pool] Repaired runtime URL:", url);
      }
      return { client, connectedUrl: url };
    } catch (err) {
      lastError = err;
      client.close();
      console.error(
        "[gateway-pool] Connection failed:",
        url,
        err instanceof Error ? err.message : err,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to connect to gateway");
}

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

  // Close stale connection — but only if no active request is using it
  if (existing) {
    if (activeClients.has(existing.client)) {
      // Client is mid-request, return it anyway (don't recycle under its feet)
      return existing.client;
    }
    existing.client.close();
    pool.delete(key);
  }

  // Create new connection with device key from runtime metadata
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const { client, connectedUrl } = await connectWithFallback({
    runtimeId: runtime.id,
    storedGatewayUrl: runtime.gatewayUrl,
    authToken: runtime.authToken || null,
    deviceKeyPem,
  });

  console.log("[gateway-pool] Connected successfully via:", connectedUrl);
  pool.set(key, { client, connectedAt: Date.now() });

  return client;
}
