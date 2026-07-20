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
import { deriveRuntimeCapabilitySnapshot } from "./runtime-capabilities";
import type { RuntimeCapabilitySnapshot } from "./runtime-capabilities";
import { publishAgentModeDiagnostic } from "./agent-mode-diagnostics";
import { resolveRuntimeAuthTokenForUse } from "./runtime-token-crypto";

// ─── Constants ──────────────────────────────────────────────────────

const MIN_PROTOCOL_VERSION = 4;
const MAX_PROTOCOL_VERSION = 4;
const DEFAULT_SCOPES = ["operator.admin"];
const CLIENT_ID = "gateway-client";
const CLIENT_VERSION = "crewcmd/1.0.0";
const CLIENT_MODE = "backend";
const DEFAULT_ROLE = "operator";
const DEFAULT_CAPS = ["tool-events"];

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

export interface GatewaySkillStatusEntry {
  name: string;
  skillKey: string;
  enabled?: boolean;
  env?: Record<string, string>;
  version?: string;
  source?: string;
  slug?: string;
  path?: string;
  installed?: boolean;
}

export interface GatewaySkillsStatusResult {
  skills: GatewaySkillStatusEntry[];
}

export interface GatewaySkillSearchResult {
  skills?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
}

export interface GatewaySkillInstallResult {
  ok?: boolean;
  installed?: boolean;
  updated?: boolean;
  slug?: string;
  version?: string;
  path?: string;
  warning?: string;
  warnings?: string[];
}

export interface GatewaySkillUpdateResult {
  ok?: boolean;
  updated?: boolean;
  updatedCount?: number;
  slug?: string;
  version?: string;
  warnings?: string[];
}

export interface GatewaySkillsListResult {
  skills?: GatewaySkillStatusEntry[];
  items?: GatewaySkillStatusEntry[];
  entries?: GatewaySkillStatusEntry[];
}

export interface GatewaySkillUninstallResult {
  ok?: boolean;
  removed?: boolean;
  uninstalled?: boolean;
  slug?: string;
  warnings?: string[];
}

export interface GatewayConfigSnapshot {
  hash?: string;
  raw?: string;
  config: Record<string, unknown>;
}

export interface GatewayConfigPatchResult {
  ok: boolean;
  noop?: boolean;
  path?: string;
  config?: Record<string, unknown>;
}

export interface GatewaySecretsReloadResult {
  ok?: boolean;
  reloaded?: boolean;
  degraded?: boolean;
}

export type GatewayRealtimeTalkTransport = "webrtc-sdp" | "json-pcm-websocket" | "gateway-relay";

export interface GatewayRealtimeTalkSessionParams extends Record<string, unknown> {
  sessionKey?: string;
  provider?: string;
  model?: string;
  voice?: string;
  agentId?: string;
  mode?: string;
  transport?: string;
  brain?: string;
  vadThreshold?: number;
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
}

export interface GatewayRealtimeTalkSessionResult {
  sessionId?: string;
  relaySessionId?: string;
  transport?: GatewayRealtimeTalkTransport | string;
  provider?: string;
  model?: string;
  voice?: string;
  expiresAt?: string;
  offerUrl?: string;
  websocketUrl?: string;
  clientSecret?: string;
  headers?: Record<string, string>;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayRealtimeRelayAudioParams extends Record<string, unknown> {
  relaySessionId: string;
  audioBase64: string;
  timestamp?: number;
}

export interface GatewayRealtimeRelayMarkParams extends Record<string, unknown> {
  relaySessionId: string;
  markName?: string;
}

export interface GatewayRealtimeRelayToolResultParams extends Record<string, unknown> {
  relaySessionId: string;
  callId: string;
  result: unknown;
  options?: {
    suppressResponse?: boolean;
    willContinue?: boolean;
  };
}

export interface GatewayRealtimeClientToolCallParams extends Record<string, unknown> {
  sessionKey: string;
  callId: string;
  name: string;
  args?: unknown;
  relaySessionId?: string;
}

export interface GatewayRealtimeClientToolCallResult {
  runId?: string;
  idempotencyKey?: string;
}

const REALTIME_AGENT_CONSULT_TOOL = "openclaw_agent_consult";

export interface GatewayTalkCatalogProvider {
  id: string;
  label?: string;
  configured?: boolean;
  aliases?: string[];
  modes?: string[];
  transports?: string[];
  brains?: string[];
  models?: string[];
  voices?: string[];
  defaultModel?: string;
  supportsBrowserSession?: boolean;
  supportsBargeIn?: boolean;
  supportsToolCalls?: boolean;
  [key: string]: unknown;
}

export interface GatewayTalkCatalog {
  modes?: string[];
  transports?: string[];
  brains?: string[];
  speech?: GatewayTalkCatalogProviderGroup;
  transcription?: GatewayTalkCatalogProviderGroup;
  realtime?: GatewayTalkCatalogProviderGroup;
  [key: string]: unknown;
}

export interface GatewayTalkCatalogProviderGroup {
  ready?: boolean;
  activeProvider?: string;
  providers?: GatewayTalkCatalogProvider[];
}

export interface GatewayCronJob {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule: Record<string, unknown>;
  sessionTarget?: string;
  wakeMode?: string;
  payload: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  state?: Record<string, unknown>;
  sessionKey?: string;
}

export interface GatewayCronListResult {
  jobs: GatewayCronJob[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

export interface GatewayCronRunsResult {
  runs: Array<Record<string, unknown>>;
  total?: number;
  limit?: number;
  offset?: number;
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
  avatarUrl?: string;
  identityRaw?: string;
  soulRaw?: string;
  agentsRaw?: string;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  /** Human-readable instructions when pairing is required */
  pairingInstructions?: string;
  version?: string;
  agents: DiscoveredAgent[];
  models: GatewayModel[];
  capabilities?: RuntimeCapabilitySnapshot;
  defaultAgentId?: string;
  devicePrivateKeyPem?: string;
  deviceAuth?: GatewayDeviceAuth;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyPem: string;
  source: "configured" | "generated";
}

export interface GatewayDeviceAuth {
  token: string;
  role: string;
  scopes: string[];
}

export interface GatewayConnectResult {
  version: string;
  deviceAuth?: GatewayDeviceAuth;
}

export interface GatewayClientAuthLifecycle {
  deviceAuth?: GatewayDeviceAuth | null;
  onDeviceAuthUpdated?: (deviceAuth: GatewayDeviceAuth) => void | Promise<void>;
  onDeviceAuthInvalid?: () => void | Promise<void>;
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

function withoutUndefined<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isLikelyMissingGatewayMethod(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("unknown method")
    || message.includes("method not found")
    || message.includes("unsupported method")
    || message.includes("no handler")
  );
}

function isRpcTimeoutFor(err: unknown, method: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message === `RPC timeout: ${method}`;
}

function buildRealtimeAgentConsultFallbackMessage(args: unknown): string {
  const parsed = normalizeRealtimeAgentConsultArgs(args);
  const question = firstTrimmedString(parsed.question, parsed.prompt, parsed.message, parsed.input);
  const context = firstTrimmedString(parsed.context);
  const responseStyle = firstTrimmedString(parsed.responseStyle, parsed.response_style);
  const rawArgs = question ? null : stringifyCompact(args);

  return [
    "Realtime voice requested an OpenClaw agent consult.",
    question ? `Question:\n${question}` : rawArgs ? `Tool arguments:\n${rawArgs}` : null,
    context ? `Context:\n${context}` : null,
    responseStyle ? `Spoken style:\n${responseStyle}` : null,
    "Return only the concise answer the realtime voice agent should speak next.",
  ].filter(Boolean).join("\n\n");
}

function normalizeRealtimeAgentConsultArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args !== "string") return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { question: args };
  } catch {
    return { question: args };
  }
}

function firstTrimmedString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stringifyCompact(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    const resolvedPrivateKeyPem = resolveRuntimeAuthTokenForUse(existingPrivateKeyPem);
    if (!resolvedPrivateKeyPem) {
      throw new Error("Stored gateway device identity is empty");
    }
    const privateKey = crypto.createPrivateKey(resolvedPrivateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const raw = derivePublicKeyRaw(publicKeyPem);
    return {
      deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
      publicKeyRawBase64Url: base64UrlEncode(raw),
      privateKeyPem: resolvedPrivateKeyPem,
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

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ConnectAuthPlan = {
  auth?: {
    token?: string;
    deviceToken?: string;
  };
  scopes: string[];
  signatureToken: string | null;
  usesDeviceToken: boolean;
};

function gatewayErrorDetailCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const details = (err as { gatewayDetails?: Record<string, unknown> }).gatewayDetails;
  return typeof details?.code === "string" ? details.code : null;
}

function canRetryWithDeviceToken(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const details = (err as { gatewayDetails?: Record<string, unknown> }).gatewayDetails;
  return gatewayErrorDetailCode(err) === "AUTH_TOKEN_MISMATCH"
    && (details?.canRetryWithDeviceToken === true
      || details?.recommendedNextStep === "retry_with_device_token");
}

function isLoopbackGatewayUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
    const octets = hostname.split(".");
    return octets.length === 4
      && octets[0] === "127"
      && octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255);
  } catch {
    return false;
  }
}

// ─── Gateway Client ─────────────────────────────────────────────────

export class GatewayClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private serverVersion?: string;
  private challengeResolve?: (nonce: string) => void;
  private challengeReject?: (err: Error) => void;
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private authToken: string | null;
  private deviceAuth: GatewayDeviceAuth | null;

  get isConnected(): boolean {
    return this.connected;
  }

  constructor(
    private gatewayUrl: string,
    authToken: string | null,
    private device: DeviceIdentity,
    private timeoutMs = 15000,
    private authLifecycle: GatewayClientAuthLifecycle = {},
  ) {
    this.authToken = resolveRuntimeAuthTokenForUse(authToken);
    this.deviceAuth = authLifecycle.deviceAuth ?? null;
  }

  /**
   * Connect to the gateway with device auth challenge-response.
   */
  async connect(): Promise<GatewayConnectResult> {
    const initialPlan = this.buildInitialAuthPlan();

    try {
      return await this.connectOnce(initialPlan);
    } catch (err) {
      if (initialPlan.usesDeviceToken && gatewayErrorDetailCode(err) === "AUTH_DEVICE_TOKEN_MISMATCH") {
        await this.invalidateStoredDeviceAuth();
      }

      if (
        !this.authToken
        || !this.deviceAuth
        || !isLoopbackGatewayUrl(this.gatewayUrl)
        || !canRetryWithDeviceToken(err)
      ) {
        throw err;
      }

      publishAgentModeDiagnostic({
        scope: "gateway-client",
        event: "connect.retry-device-token",
        detail: { url: this.gatewayUrl, deviceId: this.device.deviceId },
      });
      this.resetTransportForRetry();

      try {
        return await this.connectOnce({
          auth: {
            token: this.authToken,
            deviceToken: this.deviceAuth.token,
          },
          scopes: [...this.deviceAuth.scopes],
          signatureToken: this.authToken,
          usesDeviceToken: true,
        });
      } catch (retryErr) {
        if (gatewayErrorDetailCode(retryErr) === "AUTH_DEVICE_TOKEN_MISMATCH") {
          await this.invalidateStoredDeviceAuth();
        }
        throw retryErr;
      }
    }
  }

  private buildInitialAuthPlan(): ConnectAuthPlan {
    if (this.authToken) {
      return {
        auth: { token: this.authToken },
        scopes: [...DEFAULT_SCOPES],
        signatureToken: this.authToken,
        usesDeviceToken: false,
      };
    }

    if (this.deviceAuth) {
      return {
        auth: {
          token: this.deviceAuth.token,
          deviceToken: this.deviceAuth.token,
        },
        scopes: [...this.deviceAuth.scopes],
        signatureToken: this.deviceAuth.token,
        usesDeviceToken: true,
      };
    }

    return {
      scopes: [...DEFAULT_SCOPES],
      signatureToken: null,
      usesDeviceToken: false,
    };
  }

  private async invalidateStoredDeviceAuth(): Promise<void> {
    this.deviceAuth = null;
    await this.authLifecycle.onDeviceAuthInvalid?.();
  }

  private resetTransportForRetry(): void {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    this.challengeResolve = undefined;
    this.challengeReject = undefined;
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();
    try { ws?.close(); } catch { /* ignore */ }
  }

  private async connectOnce(authPlan: ConnectAuthPlan): Promise<GatewayConnectResult> {
    publishAgentModeDiagnostic({
      scope: "gateway-client",
      event: "connect.start",
      detail: {
        url: this.gatewayUrl,
        timeoutMs: this.timeoutMs,
        usesDeviceToken: authPlan.usesDeviceToken,
      },
    });
    const challengePromise = new Promise<string>((resolve, reject) => {
      this.challengeResolve = resolve;
      this.challengeReject = reject;
    });
    // Prevent unhandled rejection if challenge promise is never awaited
    challengePromise.catch(() => {});

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        publishAgentModeDiagnostic({
          scope: "gateway-client",
          event: "connect.timeout",
          detail: { url: this.gatewayUrl, timeoutMs: this.timeoutMs },
        });
        this.resetTransportForRetry();
        reject(new Error("Connection timeout"));
      }, this.timeoutMs);

      try {
        this.ws = new WebSocket(this.gatewayUrl);
      } catch (err) {
        clearTimeout(timer);
        reject(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      const ws = this.ws;

      ws.on("error", (err) => {
        if (this.ws !== ws) return;
        clearTimeout(timer);
        publishAgentModeDiagnostic({
          scope: "gateway-client",
          event: "websocket.error",
          detail: { message: err.message, pending: this.pending.size },
        });
        this.challengeReject?.(err);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      ws.on("close", (code, reason) => {
        if (this.ws !== ws) return;
        this.connected = false;
        const err = new Error(`Connection closed (${code}): ${reason?.toString() || ""}`);
        publishAgentModeDiagnostic({
          scope: "gateway-client",
          event: "websocket.close",
          detail: {
            code,
            reason: reason?.toString() || "",
            pending: this.pending.size,
            listeners: [...this.eventListeners.values()].reduce((total, listeners) => total + listeners.size, 0),
          },
        });
        this.challengeReject?.(err);
        for (const [, p] of this.pending) {
          if (p.timer) clearTimeout(p.timer);
          p.reject(err);
        }
        this.pending.clear();
      });

      ws.on("message", (data) => {
        if (this.ws !== ws) return;
        this.handleMessage(data.toString());
      });

      // Wait for challenge, then send signed connect
      ws.on("open", () => {
        if (this.ws !== ws) return;
        challengePromise
          .then((nonce) => {
            const signedAtMs = Date.now();
            const payloadStr = buildDeviceAuthPayloadV3({
              deviceId: this.device.deviceId,
              role: DEFAULT_ROLE,
              scopes: authPlan.scopes,
              signedAtMs,
              token: authPlan.signatureToken,
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
                const auth = helloOk?.auth as {
                  deviceToken?: unknown;
                  role?: unknown;
                  scopes?: unknown;
                } | undefined;
                const nextDeviceAuth = typeof auth?.deviceToken === "string" && auth.deviceToken.trim()
                  ? {
                      token: auth.deviceToken.trim(),
                      role: typeof auth.role === "string" && auth.role.trim() ? auth.role.trim() : DEFAULT_ROLE,
                      scopes: Array.isArray(auth.scopes)
                        ? auth.scopes.filter((scope): scope is string => typeof scope === "string" && !!scope.trim())
                        : [...authPlan.scopes],
                    }
                  : undefined;
                this.serverVersion = server?.version || "unknown";
                Promise.resolve(
                  nextDeviceAuth
                    ? this.authLifecycle.onDeviceAuthUpdated?.(nextDeviceAuth)
                    : undefined,
                ).then(() => {
                  if (nextDeviceAuth) this.deviceAuth = nextDeviceAuth;
                  publishAgentModeDiagnostic({
                    scope: "gateway-client",
                    event: "connect.complete",
                    detail: {
                      version: this.serverVersion,
                      receivedDeviceToken: !!nextDeviceAuth,
                    },
                  });
                  resolve({ version: this.serverVersion!, deviceAuth: nextDeviceAuth });
                }).catch((persistErr) => {
                  this.resetTransportForRetry();
                  reject(new Error(
                    `Failed to persist gateway device credential: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
                  ));
                });
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
                minProtocol: MIN_PROTOCOL_VERSION,
                maxProtocol: MAX_PROTOCOL_VERSION,
                client: {
                  id: CLIENT_ID,
                  version: CLIENT_VERSION,
                  platform: process.platform,
                  mode: CLIENT_MODE,
                },
                role: DEFAULT_ROLE,
                scopes: authPlan.scopes,
                caps: DEFAULT_CAPS,
                auth: authPlan.auth,
                device: {
                  id: this.device.deviceId,
                  publicKey: this.device.publicKeyRawBase64Url,
                  signature,
                  signedAt: signedAtMs,
                  nonce,
                },
              },
            };

            ws.send(JSON.stringify(connectFrame));
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
    const startedAt = Date.now();
    publishAgentModeDiagnostic({
      scope: "gateway-client",
      event: "rpc.start",
      detail: { method, reqId, pending: this.pending.size + 1 },
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        publishAgentModeDiagnostic({
          scope: "gateway-client",
          event: "rpc.timeout",
          detail: { method, reqId, elapsedMs: Date.now() - startedAt, pending: this.pending.size },
        });
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(reqId, {
        resolve: (value) => {
          clearTimeout(timer);
          publishAgentModeDiagnostic({
            scope: "gateway-client",
            event: "rpc.complete",
            detail: { method, reqId, elapsedMs: Date.now() - startedAt, pending: this.pending.size },
          });
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          publishAgentModeDiagnostic({
            scope: "gateway-client",
            event: "rpc.error",
            detail: {
              method,
              reqId,
              elapsedMs: Date.now() - startedAt,
              pending: this.pending.size,
              message: err instanceof Error ? err.message : String(err),
            },
          });
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

  async skillsUpdate(params: {
    skillKey: string;
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
  }): Promise<{ ok: boolean }> {
    return this.rpc<{ ok: boolean }>("skills.update", params);
  }

  async skillsStatus(params: {
    agentId?: string;
  } = {}): Promise<GatewaySkillsStatusResult> {
    return this.rpc<GatewaySkillsStatusResult>("skills.status", params);
  }

  async skillsList(params: {
    source?: "clawhub";
    agentId?: string;
  } = {}): Promise<GatewaySkillsListResult> {
    return this.rpc<GatewaySkillsListResult>("skills.list", params);
  }

  async skillsSearch(params: {
    query?: string;
    limit?: number;
  } = {}): Promise<GatewaySkillSearchResult> {
    return this.rpc<GatewaySkillSearchResult>("skills.search", params);
  }

  async skillsDetail(params: {
    slug: string;
    version?: string;
  }): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>("skills.detail", params);
  }

  async skillsInstall(params: {
    source: "clawhub";
    slug: string;
    version?: string;
    force?: boolean;
  } | {
    name: string;
    installId: string;
    dangerouslyForceUnsafeInstall?: boolean;
    timeoutMs?: number;
  }): Promise<GatewaySkillInstallResult> {
    return this.rpc<GatewaySkillInstallResult>("skills.install", params);
  }

  async skillsUpdateManaged(params: {
    source: "clawhub";
    slug?: string;
    all?: boolean;
    agentId?: string;
    force?: boolean;
  }): Promise<GatewaySkillUpdateResult> {
    return this.rpc<GatewaySkillUpdateResult>("skills.update", params);
  }

  async skillsUninstall(params: {
    source: "clawhub";
    slug: string;
    force?: boolean;
  }): Promise<GatewaySkillUninstallResult> {
    return this.rpc<GatewaySkillUninstallResult>("skills.uninstall", params);
  }

  async configGet(): Promise<GatewayConfigSnapshot> {
    return this.rpc<GatewayConfigSnapshot>("config.get", {});
  }

  async configPatch(params: {
    patch: Record<string, unknown>;
    baseHash?: string;
    note?: string;
    sessionKey?: string;
    restartDelayMs?: number;
  }): Promise<GatewayConfigPatchResult> {
    const baseHash =
      typeof params.baseHash === "string" && params.baseHash.trim()
        ? params.baseHash
        : undefined;
    const resolvedBaseHash = baseHash ?? (await this.configGet()).hash;
    if (typeof resolvedBaseHash !== "string" || !resolvedBaseHash.trim()) {
      throw new Error("Gateway config.get did not return a usable base hash");
    }

    return this.rpc<GatewayConfigPatchResult>("config.patch", {
      raw: JSON.stringify(params.patch),
      baseHash: resolvedBaseHash,
      ...(params.note ? { note: params.note } : {}),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(typeof params.restartDelayMs === "number"
        ? { restartDelayMs: params.restartDelayMs }
        : {}),
    });
  }

  async secretsReload(): Promise<GatewaySecretsReloadResult> {
    return this.rpc<GatewaySecretsReloadResult>("secrets.reload", {});
  }

  async talkCatalog(): Promise<GatewayTalkCatalog> {
    return this.rpc<GatewayTalkCatalog>("talk.catalog", {});
  }

  async realtimeTalkSession(
    params: GatewayRealtimeTalkSessionParams = {},
  ): Promise<GatewayRealtimeTalkSessionResult> {
    const clientParams = withoutUndefined(params);
    try {
      return await this.rpc<GatewayRealtimeTalkSessionResult>("talk.client.create", clientParams);
    } catch (err) {
      if (
        !isLikelyMissingGatewayMethod(err) &&
        params.transport &&
        params.transport !== "gateway-relay"
      ) throw err;
    }

    try {
      const sessionParams = withoutUndefined(params);
      delete sessionParams.agentId;
      return await this.rpc<GatewayRealtimeTalkSessionResult>("talk.session.create", {
        ...sessionParams,
        mode: params.mode ?? "realtime",
        transport: params.transport ?? "gateway-relay",
        brain: params.brain ?? "agent-consult",
      });
    } catch (err) {
      if (!isLikelyMissingGatewayMethod(err)) throw err;
      return this.rpc<GatewayRealtimeTalkSessionResult>("talk.realtime.session", params);
    }
  }

  async realtimeRelayAudio(params: GatewayRealtimeRelayAudioParams): Promise<{ ok?: boolean }> {
    try {
      return await this.rpc<{ ok?: boolean }>("talk.session.appendAudio", withoutUndefined({
        sessionId: params.relaySessionId,
        audioBase64: params.audioBase64,
        timestamp: params.timestamp,
      }));
    } catch (err) {
      if (!isLikelyMissingGatewayMethod(err)) throw err;
      return this.rpc<{ ok?: boolean }>("talk.realtime.relayAudio", params);
    }
  }

  async realtimeRelayMark(params: GatewayRealtimeRelayMarkParams): Promise<{ ok?: boolean }> {
    void params;
    return { ok: true };
  }

  async realtimeRelayCancelOutput(relaySessionId: string, reason?: string): Promise<{ ok?: boolean }> {
    try {
      return await this.rpc<{ ok?: boolean }>("talk.session.cancelOutput", withoutUndefined({
        sessionId: relaySessionId,
        reason,
      }));
    } catch (err) {
      if (!isLikelyMissingGatewayMethod(err)) throw err;
      return { ok: true };
    }
  }

  async realtimeRelayToolResult(params: GatewayRealtimeRelayToolResultParams): Promise<{ ok?: boolean }> {
    try {
      return await this.rpc<{ ok?: boolean }>("talk.session.submitToolResult", withoutUndefined({
        sessionId: params.relaySessionId,
        callId: params.callId,
        result: params.result,
        options: params.options,
      }));
    } catch (err) {
      if (
        !isLikelyMissingGatewayMethod(err) &&
        !(params.options?.willContinue && isRpcTimeoutFor(err, "talk.session.submitToolResult"))
      ) throw err;
      if (params.options?.willContinue) {
        return { ok: true };
      }
      return this.rpc<{ ok?: boolean }>("talk.realtime.relayToolResult", withoutUndefined({
        relaySessionId: params.relaySessionId,
        callId: params.callId,
        result: params.result,
      }));
    }
  }

  async realtimeClientToolCall(
    params: GatewayRealtimeClientToolCallParams,
  ): Promise<GatewayRealtimeClientToolCallResult> {
    try {
      return await this.rpc<GatewayRealtimeClientToolCallResult>("talk.client.toolCall", withoutUndefined(params));
    } catch (err) {
      if (
        (
          !isLikelyMissingGatewayMethod(err) &&
          !isRpcTimeoutFor(err, "talk.client.toolCall")
        ) ||
        params.name !== REALTIME_AGENT_CONSULT_TOOL
      ) throw err;
      return this.chatSend({
        sessionKey: params.sessionKey,
        idempotencyKey: params.callId,
        message: buildRealtimeAgentConsultFallbackMessage(params.args),
        thinking: "low",
      });
    }
  }

  async realtimeRelayStop(relaySessionId: string): Promise<{ ok?: boolean }> {
    try {
      return await this.rpc<{ ok?: boolean }>("talk.session.close", { sessionId: relaySessionId });
    } catch (err) {
      if (!isLikelyMissingGatewayMethod(err)) throw err;
      return this.rpc<{ ok?: boolean }>("talk.realtime.relayStop", { relaySessionId });
    }
  }

  async cronList(): Promise<GatewayCronListResult> {
    return this.rpc<GatewayCronListResult>("cron.list", {});
  }

  async cronAdd(params: {
    agentId?: string;
    name: string;
    description?: string;
    enabled?: boolean;
    schedule: Record<string, unknown>;
    sessionTarget?: string;
    wakeMode?: string;
    payload: Record<string, unknown>;
    delivery?: Record<string, unknown>;
    sessionKey?: string;
  }): Promise<GatewayCronJob> {
    return this.rpc<GatewayCronJob>("cron.add", params);
  }

  async cronUpdate(params: {
    id: string;
    patch: Record<string, unknown>;
  }): Promise<GatewayCronJob> {
    return this.rpc<GatewayCronJob>("cron.update", params);
  }

  async cronRemove(id: string): Promise<{ ok: boolean; removed?: boolean }> {
    return this.rpc<{ ok: boolean; removed?: boolean }>("cron.remove", { id });
  }

  async cronRuns(params: {
    id: string;
    limit?: number;
  }): Promise<GatewayCronRunsResult> {
    return this.rpc<GatewayCronRunsResult>("cron.runs", params);
  }

  async listAgentFiles(agentId: string): Promise<GatewayFilesListResult> {
    return this.rpc<GatewayFilesListResult>("agents.files.list", { agentId });
  }

  async getAgentFile(agentId: string, name: string): Promise<GatewayFileGetResult> {
    return this.rpc<GatewayFileGetResult>("agents.files.get", { agentId, name });
  }

  async setAgentFile(
    agentId: string,
    name: string,
    content: string
  ): Promise<GatewayFileGetResult> {
    return this.rpc<GatewayFileGetResult>("agents.files.set", {
      agentId,
      name,
      content,
    });
  }

  on(event: string, callback: (payload: unknown) => void): void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(callback);
  }

  off(event: string, callback: (payload: unknown) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) this.eventListeners.delete(event);
    }
  }

  async chatSend(params: {
    message: string;
    sessionKey?: string;
    thinking?: string;
    idempotencyKey?: string;
  }): Promise<{ runId: string; status: string }> {
    return this.rpc("chat.send", {
      message: params.message,
      sessionKey: params.sessionKey || "main",
      deliver: false,
      ...(params.thinking ? { thinking: params.thinking } : {}),
      idempotencyKey: params.idempotencyKey || crypto.randomUUID(),
    });
  }

  async chatHistory(params: {
    sessionKey?: string;
    agentId?: string;
    limit?: number;
  }): Promise<unknown> {
    return this.rpc("chat.history", params);
  }

  async chatAbort(params: {
    sessionKey?: string;
  }): Promise<unknown> {
    return this.rpc("chat.abort", params);
  }

  close(): void {
    publishAgentModeDiagnostic({
      scope: "gateway-client",
      event: "close",
      detail: {
        connected: this.connected,
        pending: this.pending.size,
        listeners: [...this.eventListeners.values()].reduce((total, listeners) => total + listeners.size, 0),
      },
    });
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.pending.size > 0) {
      const err = new Error("Gateway client closed");
      for (const [, p] of this.pending) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    }
    this.connected = false;
    this.eventListeners.clear();
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Handle events
    if (msg.type === "event") {
      const event = msg.event as string;
      const payload = msg.payload as Record<string, unknown> | undefined;

      if (event === "connect.challenge") {
        const nonce = payload?.nonce as string | undefined;
        if (nonce && this.challengeResolve) {
          this.challengeResolve(nonce);
        }
      }

      // Also emit on the wildcard channel so consumers can see all events
      const wildcardListeners = this.eventListeners.get("*");
      if (wildcardListeners) {
        for (const cb of wildcardListeners) {
          try { cb({ event, ...(payload as Record<string, unknown> || {}) }); } catch { /* listener error */ }
        }
      }

      // Emit to registered listeners
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(payload); } catch { /* listener error */ }
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
  const client = new GatewayClient(gatewayUrl, authToken, device);
  try {
    const { version, deviceAuth } = await client.connect();
    return await discoverFromClient(client, version, device.privateKeyPem, deviceAuth);
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
  devicePrivateKeyPem: string,
  deviceAuth?: GatewayDeviceAuth,
): Promise<ProbeResult> {
  try {
    const [agentsResult, modelsResult, configSnapshot] = await Promise.all([
      client.listAgents().catch(() => null),
      client.listModels().catch(() => null),
      client.configGet().catch(() => null),
    ]);

    if (!agentsResult) {
      return { ok: false, error: "Failed to list agents", agents: [], models: [] };
    }

    const discoveredAgents: DiscoveredAgent[] = [];

    // Read identity files for each agent in parallel
    const fileReads = agentsResult.agents.map(async (agent) => {
      let identityRaw: string | undefined;
      let soulRaw: string | undefined;
      let agentsMdRaw: string | undefined;
      let workspace: string | undefined;

      try {
        const filesResult = await client.listAgentFiles(agent.id);
        if (filesResult.workspace) {
          workspace = filesResult.workspace;
        }
      } catch { /* workspace discovery unsupported */ }

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

      try {
        const agentsMdResult = await client.getAgentFile(agent.id, "AGENTS.md");
        if (agentsMdResult.file && !agentsMdResult.file.missing) {
          agentsMdRaw = agentsMdResult.file.content;
        }
      } catch { /* file doesn't exist */ }

      discoveredAgents.push(parseAgentIdentity(agent, identityRaw, soulRaw, agentsMdRaw, workspace));
    });

    await Promise.all(fileReads);

    return {
      ok: true,
      version,
      agents: discoveredAgents,
      models: modelsResult?.models ?? [],
      capabilities: configSnapshot?.config
        ? deriveRuntimeCapabilitySnapshot({
            config: configSnapshot.config,
            models: modelsResult?.models ?? [],
          })
        : undefined,
      defaultAgentId: agentsResult.defaultId,
      devicePrivateKeyPem,
      deviceAuth,
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
  soulRaw?: string,
  agentsMdRaw?: string,
  workspace?: string
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

  // Parse AGENTS.md (fallback for reportsTo, role/title)
  if (agentsMdRaw) {
    if (!reportsTo) {
      // Match "**Reports to:** Name (Title)" or "- **Reports to:** Name"
      const reportsMatch = agentsMdRaw.match(/\*?\*?Reports?\s*to:?\*?\*?\s*(.+)/i);
      if (reportsMatch?.[1]?.trim()) {
        // Extract just the name, strip parenthetical like "(CTO)"
        reportsTo = reportsMatch[1].trim().split(/\s*\(/)[0].trim();
      }
    }
    if (title === "Agent") {
      const roleMatch = agentsMdRaw.match(/\*?\*?Role:?\*?\*?\s*(.+)/i);
      if (roleMatch?.[1]?.trim()) {
        title = roleMatch[1].trim();
      }
    }
  }

  return {
    id: agent.id,
    name,
    emoji,
    title,
    description,
    reportsTo,
    workspace,
    avatarUrl: agent.identity?.avatarUrl || agent.identity?.avatar || undefined,
    identityRaw,
    soulRaw,
    agentsRaw: agentsMdRaw,
  };
}
