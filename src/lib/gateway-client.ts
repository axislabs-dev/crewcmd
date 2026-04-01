/**
 * OpenClaw Gateway WebSocket RPC Client
 *
 * Connects to an OpenClaw gateway via WebSocket with Ed25519 device auth,
 * performs challenge-response handshake, auto-pairs on first connect,
 * and provides typed RPC methods for agent/model/skill discovery.
 *
 * Based on Paperclip's openclaw-gateway adapter pattern.
 * Used server-side only (API routes). Never runs in the browser.
 */

import crypto from "node:crypto";
import WebSocket from "ws";

// ─── Constants ──────────────────────────────────────────────────────

const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = ["operator.read", "operator.write"];
const CLIENT_ID = "gateway-client";
const CLIENT_VERSION = "crewcmd/1.0.0";
const CLIENT_MODE = "backend";
const DEFAULT_ROLE = "operator";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ─── Types ──────────────────────────────────────────────────────────

export interface GatewayAgent {
  id: string;
  name?: string;
  identity?: {
    name?: string;
    theme?: string;
    emoji?: string;
    avatar?: string;
    avatarUrl?: string;
  };
}

export interface GatewayAgentsListResult {
  defaultId: string;
  mainKey: string;
  scope: "per-sender" | "global";
  agents: GatewayAgent[];
}

export interface GatewayModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface GatewayModelsListResult {
  models: GatewayModel[];
}

export interface GatewayFileEntry {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export interface GatewayFilesListResult {
  agentId: string;
  workspace: string;
  files: GatewayFileEntry[];
}

export interface GatewayFileGetResult {
  agentId: string;
  workspace: string;
  file: GatewayFileEntry;
}

export interface DiscoveredAgent {
  id: string;
  name: string;
  emoji: string;
  title: string;
  description: string;
  model?: string;
  workspace?: string;
  reportsTo?: string;
  identityRaw?: string;
  soulRaw?: string;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  /** Human-readable instructions when pairing is required */
  pairingInstructions?: string;
  version?: string;
  agents: DiscoveredAgent[];
  models: GatewayModel[];
  defaultAgentId?: string;
  devicePrivateKeyPem?: string;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyPem: string;
  source: "configured" | "generated";
}

// ─── Crypto Helpers ─────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

/**
 * Build v3 device auth payload string for signing.
 */
function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
}): string {
  return [
    "v3",
    params.deviceId,
    CLIENT_ID,
    CLIENT_MODE,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    process.platform,
    "", // deviceFamily
  ].join("|");
}

/**
 * Generate or restore a device identity (Ed25519 keypair).
 */
export function resolveDeviceIdentity(existingPrivateKeyPem?: string): DeviceIdentity {
  if (existingPrivateKeyPem) {
    const privateKey = crypto.createPrivateKey(existingPrivateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const raw = derivePublicKeyRaw(publicKeyPem);
    return {
      deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
      publicKeyRawBase64Url: base64UrlEncode(raw),
      privateKeyPem: existingPrivateKeyPem,
      source: "configured",
    };
  }

  const generated = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = generated.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const raw = derivePublicKeyRaw(publicKeyPem);
  return {
    deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
    publicKeyRawBase64Url: base64UrlEncode(raw),
    privateKeyPem,
    source: "generated",
  };
}

// ─── WebSocket Frame Types ──────────────────────────────────────────

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

interface EventFrame {
  type: "event";
  event: string;
  payload?: Record<string, unknown>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

// ─── Gateway Client ─────────────────────────────────────────────────

export class GatewayClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private serverVersion?: string;
  private challengeResolve?: (nonce: string) => void;
  private challengeReject?: (err: Error) => void;

  constructor(
    private gatewayUrl: string,
    private authToken: string | null,
    private device: DeviceIdentity,
    private timeoutMs = 15000
  ) {}

  /**
   * Connect to the gateway with device auth challenge-response.
   */
  async connect(): Promise<{ version: string }> {
    const challengePromise = new Promise<string>((resolve, reject) => {
      this.challengeResolve = resolve;
      this.challengeReject = reject;
    });
    // Prevent unhandled rejection if challenge promise is never awaited
    challengePromise.catch(() => {});

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error("Connection timeout"));
      }, this.timeoutMs);

      try {
        const headers: Record<string, string> = {};
        if (this.authToken) {
          headers.authorization = `Bearer ${this.authToken}`;
        }
        this.ws = new WebSocket(this.gatewayUrl, { headers });
      } catch (err) {
        clearTimeout(timer);
        reject(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      this.ws.on("error", (err) => {
        clearTimeout(timer);
        this.challengeReject?.(err);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on("close", (code, reason) => {
        this.connected = false;
        const err = new Error(`Connection closed (${code}): ${reason?.toString() || ""}`);
        this.challengeReject?.(err);
        for (const [, p] of this.pending) {
          if (p.timer) clearTimeout(p.timer);
          p.reject(err);
        }
        this.pending.clear();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      // Wait for challenge, then send signed connect
      this.ws.on("open", () => {
        challengePromise
          .then((nonce) => {
            const signedAtMs = Date.now();
            const payloadStr = buildDeviceAuthPayloadV3({
              deviceId: this.device.deviceId,
              role: DEFAULT_ROLE,
              scopes: DEFAULT_SCOPES,
              signedAtMs,
              token: this.authToken,
              nonce,
            });
            const signature = signPayload(this.device.privateKeyPem, payloadStr);

            const connectId = `gc-connect-${++this.requestId}`;

            this.pending.set(connectId, {
              resolve: (value) => {
                clearTimeout(timer);
                this.connected = true;
                const helloOk = value as Record<string, unknown>;
                const server = helloOk?.server as { version?: string } | undefined;
                this.serverVersion = server?.version || "unknown";
                resolve({ version: this.serverVersion });
              },
              reject: (err) => {
                clearTimeout(timer);
                reject(err);
              },
              timer: null,
            });

            const connectFrame = {
              type: "req",
              id: connectId,
              method: "connect",
              params: {
                minProtocol: PROTOCOL_VERSION,
                maxProtocol: PROTOCOL_VERSION,
                client: {
                  id: CLIENT_ID,
                  version: CLIENT_VERSION,
                  platform: process.platform,
                  mode: CLIENT_MODE,
                },
                role: DEFAULT_ROLE,
                scopes: DEFAULT_SCOPES,
                auth: this.authToken ? { token: this.authToken } : undefined,
                device: {
                  id: this.device.deviceId,
                  publicKey: this.device.publicKeyRawBase64Url,
                  signature,
                  signedAt: signedAtMs,
                  nonce,
                },
              },
            };

            this.ws!.send(JSON.stringify(connectFrame));
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    });
  }

  /**
   * Send an RPC request and wait for the response.
   */
  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected to gateway");
    }

    const reqId = `gc-${++this.requestId}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(reqId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      this.ws!.send(JSON.stringify({
        type: "req",
        id: reqId,
        method,
        params,
      }));
    });
  }

  async listAgents(): Promise<GatewayAgentsListResult> {
    return this.rpc<GatewayAgentsListResult>("agents.list", {});
  }

  async listModels(): Promise<GatewayModelsListResult> {
    return this.rpc<GatewayModelsListResult>("models.list", {});
  }

  async listAgentFiles(agentId: string): Promise<GatewayFilesListResult> {
    return this.rpc<GatewayFilesListResult>("agents.files.list", { agentId });
  }

  async getAgentFile(agentId: string, name: string): Promise<GatewayFileGetResult> {
    return this.rpc<GatewayFileGetResult>("agents.files.get", { agentId, name });
  }

  close(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Handle challenge event
    if (msg.type === "event") {
      const event = msg.event as string;
      if (event === "connect.challenge") {
        const payload = msg.payload as { nonce?: string } | undefined;
        const nonce = payload?.nonce;
        if (nonce && this.challengeResolve) {
          this.challengeResolve(nonce);
        }
      }
      return;
    }

    // Handle RPC responses
    if (msg.type === "res") {
      const frame = msg as unknown as ResponseFrame;
      const p = this.pending.get(frame.id);
      if (!p) return;

      if (p.timer) clearTimeout(p.timer);
      this.pending.delete(frame.id);

      if (frame.ok) {
        p.resolve(frame.payload ?? {});
      } else {
        const errMsg = frame.error?.message || frame.error?.code || "RPC error";
        const err = new Error(errMsg) as Error & { gatewayCode?: string; gatewayDetails?: Record<string, unknown> };
        if (frame.error?.code) err.gatewayCode = frame.error.code;
        if (frame.error?.details) err.gatewayDetails = frame.error.details;
        p.reject(err);
      }
    }
  }
}

// ─── Auto-Pairing ───────────────────────────────────────────────────

// ─── High-Level Probe ───────────────────────────────────────────────

/**
 * Probe a gateway via WebSocket with device auth.
 * Handles auto-pairing on first connect.
 * Returns discovered agents, models, and the device private key for persistence.
 */
export async function probeGateway(
  gatewayUrl: string,
  authToken: string,
  existingDeviceKeyPem?: string
): Promise<ProbeResult> {
  const device = resolveDeviceIdentity(existingDeviceKeyPem);

  // First attempt
  let client = new GatewayClient(gatewayUrl, authToken, device);
  try {
    const { version } = await client.connect();
    return await discoverFromClient(client, version, device.privateKeyPem);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isPairingRequired = message.toLowerCase().includes("pairing required");

    if (!isPairingRequired) {
      return { ok: false, error: message, agents: [], models: [] };
    }

    // Device pairing is required. The gateway won't grant operator.pairing scope
    // to an unbound device (by design), so auto-approve from a second WS connection
    // is not possible. The user must approve the device on the gateway host.
    return {
      ok: false,
      error: "pairing_required",
      pairingInstructions: [
        "Your device needs approval on the OpenClaw gateway.",
        "Run one of these on the gateway host:",
        "",
        "  openclaw devices approve",
        "",
        "Or via Telegram: /pair pending, then approve the request.",
        "",
        "After approving, click 'Retry Connection' below.",
      ].join("\n"),
      agents: [],
      models: [],
      // Return the device key so the same identity is used on retry
      devicePrivateKeyPem: device.privateKeyPem,
    };
  } finally {
    client.close();
  }
}

/**
 * After a successful connection, discover agents and models.
 */
async function discoverFromClient(
  client: GatewayClient,
  version: string,
  devicePrivateKeyPem: string
): Promise<ProbeResult> {
  try {
    const [agentsResult, modelsResult] = await Promise.all([
      client.listAgents().catch(() => null),
      client.listModels().catch(() => null),
    ]);

    if (!agentsResult) {
      return { ok: false, error: "Failed to list agents", agents: [], models: [] };
    }

    const discoveredAgents: DiscoveredAgent[] = [];

    // Read identity files for each agent in parallel
    const fileReads = agentsResult.agents.map(async (agent) => {
      let identityRaw: string | undefined;
      let soulRaw: string | undefined;

      try {
        const identityResult = await client.getAgentFile(agent.id, "IDENTITY.md");
        if (identityResult.file && !identityResult.file.missing) {
          identityRaw = identityResult.file.content;
        }
      } catch { /* file doesn't exist */ }

      try {
        const soulResult = await client.getAgentFile(agent.id, "SOUL.md");
        if (soulResult.file && !soulResult.file.missing) {
          soulRaw = soulResult.file.content;
        }
      } catch { /* file doesn't exist */ }

      discoveredAgents.push(parseAgentIdentity(agent, identityRaw, soulRaw));
    });

    await Promise.all(fileReads);

    return {
      ok: true,
      version,
      agents: discoveredAgents,
      models: modelsResult?.models ?? [],
      defaultAgentId: agentsResult.defaultId,
      devicePrivateKeyPem,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      agents: [],
      models: [],
    };
  }
}

// ─── Identity Parsing ───────────────────────────────────────────────

function parseAgentIdentity(
  agent: GatewayAgent,
  identityRaw?: string,
  soulRaw?: string
): DiscoveredAgent {
  let name = agent.identity?.name || agent.name || agent.id;
  let emoji = agent.identity?.emoji || "🤖";
  let title = "Agent";
  let description = "";
  let reportsTo: string | undefined;

  // Parse IDENTITY.md
  if (identityRaw) {
    const nameMatch = identityRaw.match(/\*\*Name:\*\*\s*(.+)/);
    const emojiMatch = identityRaw.match(/\*\*Emoji:\*\*\s*(.+)/);
    const vibeMatch = identityRaw.match(/\*\*Vibe:\*\*\s*(.+)/);
    const creatureMatch = identityRaw.match(/\*\*Creature:\*\*\s*(.+)/);

    if (nameMatch?.[1]?.trim() && !nameMatch[1].includes("pick something")) {
      name = nameMatch[1].trim();
    }
    if (emojiMatch?.[1]?.trim() && !emojiMatch[1].includes("pick one") && !emojiMatch[1].includes("_(")) {
      emoji = emojiMatch[1].trim();
    }
    if (creatureMatch?.[1]?.trim() && !creatureMatch[1].includes("_")) {
      title = creatureMatch[1].trim();
    }
    if (vibeMatch?.[1]?.trim() && !vibeMatch[1].includes("_")) {
      description = vibeMatch[1].trim();
    }
  }

  // Parse SOUL.md (fallback + reportsTo)
  if (soulRaw) {
    const emojiMatch = soulRaw.match(/\*\*Emoji:\*\*\s*(.+)/);
    const titleMatch = soulRaw.match(/\*\*Title:\*\*\s*(.+)/);
    const reportsMatch = soulRaw.match(/\*\*Reports to:\*\*\s*(.+)/);
    const taglineMatch = soulRaw.match(/^#.+\n+_(.+)_$/m);

    if (emoji === "🤖" && emojiMatch?.[1]?.trim()) emoji = emojiMatch[1].trim();
    if (title === "Agent" && titleMatch?.[1]?.trim()) title = titleMatch[1].trim();
    if (reportsMatch?.[1]?.trim()) reportsTo = reportsMatch[1].trim().split(/\s/)[0];

    if (!description) {
      if (taglineMatch?.[1]?.trim() && !taglineMatch[1].includes("not a chatbot")) {
        description = taglineMatch[1].trim().slice(0, 200);
      } else {
        const lines = soulRaw.split("\n").filter((l) => l.trim());
        const descLine = lines.find(
          (l) => !l.startsWith("#") && !l.startsWith("_") && !l.startsWith("-") && l.length > 20
        );
        if (descLine) description = descLine.trim().slice(0, 200);
      }
    }
  }

  return { id: agent.id, name, emoji, title, description, reportsTo, identityRaw, soulRaw };
}
