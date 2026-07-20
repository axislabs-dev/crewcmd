import type { GatewayDeviceAuth } from "./gateway-client";
import {
  isEncryptedRuntimeAuthToken,
  resolveRuntimeAuthTokenForUse,
  sealRuntimeAuthToken,
  type RuntimeTokenCryptoEnv,
} from "./runtime-token-crypto";

const DEVICE_AUTH_METADATA_KEY = "openclawDeviceAuth";
const DEVICE_AUTH_VERSION = 1;

interface StoredRuntimeDeviceAuth {
  version: 1;
  deviceId: string;
  role: string;
  scopes: string[];
  tokenCiphertext: string;
  updatedAt: string;
}

function asMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function normalizeScopes(scopes: unknown): string[] | null {
  if (!Array.isArray(scopes)) return null;
  const normalized = [...new Set(
    scopes
      .filter((scope): scope is string => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter(Boolean),
  )];
  return normalized.length > 0 ? normalized : null;
}

function parseStoredDeviceAuth(value: unknown): StoredRuntimeDeviceAuth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  const scopes = normalizeScopes(stored.scopes);
  if (
    stored.version !== DEVICE_AUTH_VERSION
    || typeof stored.deviceId !== "string"
    || !stored.deviceId.trim()
    || typeof stored.role !== "string"
    || !stored.role.trim()
    || !scopes
    || typeof stored.tokenCiphertext !== "string"
    || !stored.tokenCiphertext.trim()
    || typeof stored.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    version: DEVICE_AUTH_VERSION,
    deviceId: stored.deviceId.trim(),
    role: stored.role.trim(),
    scopes,
    tokenCiphertext: stored.tokenCiphertext,
    updatedAt: stored.updatedAt,
  };
}

export function readRuntimeDeviceAuth(
  metadata: unknown,
  expectedDeviceId: string,
  env: RuntimeTokenCryptoEnv = process.env,
): GatewayDeviceAuth | null {
  const stored = parseStoredDeviceAuth(asMetadata(metadata)[DEVICE_AUTH_METADATA_KEY]);
  if (!stored || stored.deviceId !== expectedDeviceId) return null;
  const token = resolveRuntimeAuthTokenForUse(stored.tokenCiphertext, env);
  if (!token) return null;
  return {
    token,
    role: stored.role,
    scopes: stored.scopes,
  };
}

export function storeRuntimeDeviceAuth(
  metadata: unknown,
  deviceId: string,
  deviceAuth: GatewayDeviceAuth,
  env: RuntimeTokenCryptoEnv = process.env,
): Record<string, unknown> {
  const normalizedDeviceId = deviceId.trim();
  const role = deviceAuth.role.trim();
  const scopes = normalizeScopes(deviceAuth.scopes);
  const token = deviceAuth.token.trim();
  if (!normalizedDeviceId || !role || !scopes || !token) {
    throw new Error("Gateway device credential is incomplete");
  }
  const tokenCiphertext = sealRuntimeAuthToken(token, env);
  if (!tokenCiphertext) throw new Error("Gateway device credential is empty");

  return {
    ...asMetadata(metadata),
    [DEVICE_AUTH_METADATA_KEY]: {
      version: DEVICE_AUTH_VERSION,
      deviceId: normalizedDeviceId,
      role,
      scopes,
      tokenCiphertext,
      updatedAt: new Date().toISOString(),
    } satisfies StoredRuntimeDeviceAuth,
  };
}

export function clearRuntimeDeviceAuth(metadata: unknown): Record<string, unknown> {
  const next = asMetadata(metadata);
  delete next[DEVICE_AUTH_METADATA_KEY];
  return next;
}

export function sealRuntimeDevicePrivateKey(
  storedOrPlaintextKey: string,
  env: RuntimeTokenCryptoEnv = process.env,
): string {
  if (isEncryptedRuntimeAuthToken(storedOrPlaintextKey)) return storedOrPlaintextKey;
  const sealed = sealRuntimeAuthToken(storedOrPlaintextKey, env);
  if (!sealed) throw new Error("Gateway device private key is empty");
  return sealed;
}

export function removeRuntimeAuthSecretsFromMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const safe = asMetadata(metadata);
  delete safe.devicePrivateKeyPem;
  delete safe[DEVICE_AUTH_METADATA_KEY];
  return safe;
}
