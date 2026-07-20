/**
 * Gateway Chat Connection Pool
 *
 * Maintains one WebSocket connection per runtime, reused across chat requests.
 * Connections are recycled after 5 minutes to avoid stale state.
 */

import { readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { GatewayClient, resolveDeviceIdentity, type GatewayDeviceAuth } from "./gateway-client";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { publishAgentModeDiagnostic } from "./agent-mode-diagnostics";
import {
  clearRuntimeDeviceAuth,
  readRuntimeDeviceAuth,
  sealRuntimeDevicePrivateKey,
  storeRuntimeDeviceAuth,
} from "./runtime-device-auth";

interface PoolEntry {
  client: GatewayClient;
  connectedAt: number;
}

interface GatewayRuntimeConnection {
  id: string;
  gatewayUrl: string | null;
  authToken?: string | null;
  metadata?: unknown;
  isPrimary?: boolean;
  status?: string | null;
  lastPing?: Date | string | null;
  updatedAt?: Date | string | null;
}

const pool = new Map<string, PoolEntry>();
const lastConnectionByRuntime = new Map<string, GatewayConnectionDiagnostic>();

const MAX_CONNECTION_AGE_MS = 300_000; // 5 minutes
const LOCAL_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

/**
 * Mark a client as "in use" so the pool won't recycle it mid-request.
 * Call release() when done.
 */
const activeClientHolds = new Map<GatewayClient, number>();

export type GatewayFailureClassification =
  | "configuration"
  | "authentication"
  | "pairing_required"
  | "timeout"
  | "network"
  | "unknown";

export interface GatewayConnectionDiagnostic {
  status: "connected" | "failed";
  at: string;
  url: string | null;
  error: string | null;
  classification: GatewayFailureClassification | null;
}

export interface GatewayRuntimeDiagnostic {
  id: string;
  gatewayUrl: string | null;
  hasAuthToken: boolean;
  isPrimary: boolean;
  status: string | null;
  lastPing: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown> | null;
  pool: {
    connected: boolean;
    ageMs: number | null;
    held: boolean;
    holds: number;
  };
  lastConnection: GatewayConnectionDiagnostic | null;
  readiness: GatewayRuntimeReadiness;
}

export interface GatewayRuntimeReadiness {
  hasGatewayUrl: boolean;
  hasAuthToken: boolean;
  deviceIdentity: "stored" | "ephemeral";
  connectionState: "pool_connected" | "last_connected" | "last_failed" | "not_attempted";
  blockers: string[];
}

function activeClientCount() {
  return activeClientHolds.size;
}

function totalActiveHolds() {
  let total = 0;
  for (const count of activeClientHolds.values()) total += count;
  return total;
}

export function holdClient(client: GatewayClient) {
  activeClientHolds.set(client, (activeClientHolds.get(client) ?? 0) + 1);
  publishAgentModeDiagnostic({
    scope: "gateway-pool",
    event: "client.hold",
    detail: {
      activeClients: activeClientCount(),
      activeHolds: totalActiveHolds(),
      poolSize: pool.size,
    },
  });
}

export function releaseClient(client: GatewayClient) {
  const holds = activeClientHolds.get(client) ?? 0;
  if (holds <= 1) {
    activeClientHolds.delete(client);
  } else {
    activeClientHolds.set(client, holds - 1);
  }
  publishAgentModeDiagnostic({
    scope: "gateway-pool",
    event: "client.release",
    detail: {
      activeClients: activeClientCount(),
      activeHolds: totalActiveHolds(),
      poolSize: pool.size,
    },
  });
}

export function getGatewayPoolDiagnostics() {
  return {
    poolSize: pool.size,
    activeClients: activeClientCount(),
    activeHolds: totalActiveHolds(),
  };
}

export function classifyGatewayFailure(error: unknown): GatewayFailureClassification {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = message.toLowerCase();

  if (
    text.includes("no runtime configured") ||
    text.includes("no gateway url") ||
    text.includes("runtime not found")
  ) {
    return "configuration";
  }
  if (text.includes("pairing_required") || text.includes("pairing required")) {
    return "pairing_required";
  }
  if (text.includes("unauthorized") || text.includes("forbidden") || text.includes("auth") || text.includes("token")) {
    return "authentication";
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("etimedout")) {
    return "timeout";
  }
  if (
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("network") ||
    text.includes("socket") ||
    text.includes("failed to connect")
  ) {
    return "network";
  }

  return "unknown";
}

export function getGatewayDiagnosticsForRuntimes(
  runtimes: GatewayRuntimeConnection[],
): { pool: ReturnType<typeof getGatewayPoolDiagnostics>; runtimes: GatewayRuntimeDiagnostic[] } {
  return {
    pool: getGatewayPoolDiagnostics(),
    runtimes: runtimes.map((runtime) => {
      const entry = pool.get(runtime.id);
      const holds = entry ? (activeClientHolds.get(entry.client) ?? 0) : 0;
      const lastConnection = lastConnectionByRuntime.get(runtime.id) ?? null;
      const poolConnected = Boolean(entry?.client.isConnected);

      return {
        id: runtime.id,
        gatewayUrl: redactGatewayUrl(runtime.gatewayUrl),
        hasAuthToken: Boolean(runtime.authToken),
        isPrimary: Boolean(runtime.isPrimary),
        status: runtime.status ?? null,
        lastPing: toIsoString(runtime.lastPing),
        updatedAt: toIsoString(runtime.updatedAt),
        metadata: redactGatewayMetadata(runtime.metadata),
        pool: {
          connected: Boolean(entry?.client.isConnected),
          ageMs: entry ? Date.now() - entry.connectedAt : null,
          held: holds > 0,
          holds,
        },
        lastConnection,
        readiness: deriveGatewayReadiness({
          gatewayUrl: runtime.gatewayUrl,
          authToken: runtime.authToken,
          metadata: runtime.metadata,
          poolConnected,
          lastConnection,
        }),
      };
    }),
  };
}

export function deriveGatewayReadiness(params: {
  gatewayUrl?: string | null;
  authToken?: string | null;
  metadata?: unknown;
  poolConnected: boolean;
  lastConnection: GatewayConnectionDiagnostic | null;
}): GatewayRuntimeReadiness {
  const hasGatewayUrl = Boolean(params.gatewayUrl);
  const hasAuthToken = Boolean(params.authToken);
  const blockers: string[] = [];

  if (!hasGatewayUrl) blockers.push("missing_gateway_url");
  if (!hasAuthToken) blockers.push("missing_auth_token");
  if (params.lastConnection?.classification === "pairing_required") blockers.push("pairing_required");
  if (params.lastConnection?.status === "failed") blockers.push("last_connection_failed");

  return {
    hasGatewayUrl,
    hasAuthToken,
    deviceIdentity: hasStoredDeviceIdentity(params.metadata) ? "stored" : "ephemeral",
    connectionState: getConnectionState(params.poolConnected, params.lastConnection),
    blockers,
  };
}

export function resetGatewayPoolForTests() {
  for (const entry of pool.values()) {
    entry.client.close();
  }
  pool.clear();
  activeClientHolds.clear();
  lastConnectionByRuntime.clear();
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function redactGatewayUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0]?.split("#")[0] ?? value;
  }
}

function redactGatewayMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (isSensitiveMetadataKey(key)) {
      redacted[key] = "[redacted]";
    } else if (value instanceof Date) {
      redacted[key] = value.toISOString();
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactGatewayMetadata(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function hasStoredDeviceIdentity(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const privateKey = (metadata as Record<string, unknown>).devicePrivateKeyPem;
  return typeof privateKey === "string" && privateKey.trim().length > 0;
}

function getConnectionState(
  poolConnected: boolean,
  lastConnection: GatewayConnectionDiagnostic | null
): GatewayRuntimeReadiness["connectionState"] {
  if (poolConnected) return "pool_connected";
  if (lastConnection?.status === "connected") return "last_connected";
  if (lastConnection?.status === "failed") return "last_failed";
  return "not_attempted";
}

function isSensitiveMetadataKey(key: string) {
  return /token|secret|password|credential|private|pem|key/i.test(key);
}

function rememberConnectionStatus(
  runtimeId: string,
  status: GatewayConnectionDiagnostic["status"],
  url: string | null,
  error: unknown = null,
) {
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;

  lastConnectionByRuntime.set(runtimeId, {
    status,
    at: new Date().toISOString(),
    url: redactGatewayUrl(url),
    error: redactDiagnosticMessage(errorMessage),
    classification: error ? classifyGatewayFailure(error) : null,
  });
}

function redactDiagnosticMessage(message: string | null) {
  if (!message) return null;

  return message
    .replace(/wss?:\/\/[^\s,)]+/gi, (value) => redactGatewayUrl(value) ?? "[redacted-url]")
    .replace(/https?:\/\/[^\s,)]+/gi, (value) => redactGatewayUrl(value) ?? "[redacted-url]")
    .replace(/(token|secret|password|credential|privateKey|apiKey)=([^&\s]+)/gi, "$1=[redacted]");
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

async function updateRuntimeAuthMetadata(params: {
  runtimeId: string;
  update: (metadata: unknown) => Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const runtime = await db!.query.companyRuntimes.findFirst({
      where: eq(companyRuntimes.id, params.runtimeId),
    });
    if (!runtime) throw new Error(`Runtime not found: ${params.runtimeId}`);
    const metadata = params.update(runtime.metadata);
    await db!.update(companyRuntimes)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(companyRuntimes.id, params.runtimeId));
    return metadata;
  });
}

async function connectWithFallback(params: {
  runtimeId: string;
  storedGatewayUrl: string;
  authToken: string | null;
  deviceKeyPem?: string;
  runtimeMetadata: unknown;
}): Promise<{ client: GatewayClient; connectedUrl: string }> {
  let runtimeMetadata = params.runtimeMetadata;
  let storedDeviceKey = params.deviceKeyPem;
  if (storedDeviceKey) {
    const sealedDeviceKey = sealRuntimeDevicePrivateKey(storedDeviceKey);
    if (sealedDeviceKey !== storedDeviceKey) {
      runtimeMetadata = await updateRuntimeAuthMetadata({
        runtimeId: params.runtimeId,
        update: (metadata) => ({
          ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? metadata as Record<string, unknown>
            : {}),
          devicePrivateKeyPem: sealedDeviceKey,
        }),
      });
      storedDeviceKey = sealedDeviceKey;
    }
  }

  const device = resolveDeviceIdentity(storedDeviceKey);
  let deviceAuth = readRuntimeDeviceAuth(runtimeMetadata, device.deviceId);
  console.log("[gateway-pool] Device source:", device.source, "hasStoredKey:", !!params.deviceKeyPem);

  const candidates = await buildGatewayCandidates(params.storedGatewayUrl);
  let lastError: unknown = null;

  for (const url of candidates) {
    const client = new GatewayClient(
      url,
      params.authToken,
      device,
      30000, // 30s timeout for chat
      {
        deviceAuth,
        onDeviceAuthUpdated: async (nextDeviceAuth: GatewayDeviceAuth) => {
          runtimeMetadata = await updateRuntimeAuthMetadata({
            runtimeId: params.runtimeId,
            update: (metadata) => storeRuntimeDeviceAuth(
              metadata,
              device.deviceId,
              nextDeviceAuth,
            ),
          });
          deviceAuth = nextDeviceAuth;
        },
        onDeviceAuthInvalid: async () => {
          runtimeMetadata = await updateRuntimeAuthMetadata({
            runtimeId: params.runtimeId,
            update: clearRuntimeDeviceAuth,
          });
          deviceAuth = null;
        },
      },
    );

    try {
      if (url !== params.storedGatewayUrl) {
        console.warn("[gateway-pool] Retrying runtime via fallback URL:", url);
      }
      await client.connect();
      rememberConnectionStatus(params.runtimeId, "connected", url);
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
      rememberConnectionStatus(params.runtimeId, "failed", url, err);
      client.close();
      console.error(
        "[gateway-pool] Connection failed:",
        url,
        err instanceof Error ? err.message : err,
      );
      const classification = classifyGatewayFailure(err);
      if (classification === "authentication" || classification === "pairing_required") {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to connect to gateway");
}

async function getClientForRuntime(runtime: GatewayRuntimeConnection | null | undefined) {
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
    publishAgentModeDiagnostic({
      scope: "gateway-pool",
      event: "client.reuse",
      detail: {
        runtimeId: runtime.id,
        ageMs: Date.now() - existing.connectedAt,
        poolSize: pool.size,
        activeClients: activeClientCount(),
        activeHolds: totalActiveHolds(),
      },
    });
    return existing.client;
  }

  // Close stale connection — but only if no active request is using it
  if (existing) {
    if (activeClientHolds.has(existing.client) && existing.client.isConnected) {
      // Client is mid-request, return it anyway (don't recycle under its feet)
      publishAgentModeDiagnostic({
        scope: "gateway-pool",
        event: "client.recycle.defer-active",
        detail: {
          runtimeId: runtime.id,
          ageMs: Date.now() - existing.connectedAt,
          activeClients: activeClientCount(),
          activeHolds: totalActiveHolds(),
        },
      });
      return existing.client;
    }
    activeClientHolds.delete(existing.client);
    publishAgentModeDiagnostic({
      scope: "gateway-pool",
      event: "client.recycle.close-stale",
      detail: {
        runtimeId: runtime.id,
        ageMs: Date.now() - existing.connectedAt,
        poolSize: pool.size,
      },
    });
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
    runtimeMetadata: meta,
  });

  console.log("[gateway-pool] Connected successfully via:", connectedUrl);
  pool.set(key, { client, connectedAt: Date.now() });
  publishAgentModeDiagnostic({
    scope: "gateway-pool",
    event: "client.connect",
    detail: {
      runtimeId: runtime.id,
      connectedUrl,
      poolSize: pool.size,
    },
  });

  return client;
}

export async function getGatewayClientForRuntime(runtimeId: string): Promise<GatewayClient> {
  if (!db) {
    throw new Error("Database not initialized");
  }

  if (!runtimeId) {
    throw new Error("Runtime id is required");
  }

  const runtime = await withRetry(() =>
    db!.query.companyRuntimes.findFirst({
      where: eq(companyRuntimes.id, runtimeId),
    })
  );

  if (!runtime) {
    throw new Error(`Runtime not found: ${runtimeId}`);
  }

  return getClientForRuntime(runtime);
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

  return getClientForRuntime(runtime);
}
