import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENVELOPE_PREFIX = "crewcmd:runtime-token:v1";
const AUTH_SECRET_KEY_ID = "auth-secret-v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface RuntimeTokenKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface RuntimeTokenCryptoEnv {
  readonly [key: string]: string | undefined;
  AUTH_SECRET?: string;
  CREWCMD_RUNTIME_TOKEN_KEYS?: string;
  CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID?: string;
}

function derivedAuthSecretKey(authSecret: string): Buffer {
  return createHash("sha256")
    .update("crewcmd:runtime-token:auth-secret:v1\0", "utf8")
    .update(authSecret, "utf8")
    .digest();
}

function decodeKey(keyId: string, encoded: unknown): Buffer {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error(`Runtime token key "${keyId}" must be a base64 string`);
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error(`Runtime token key "${keyId}" must decode to exactly 32 bytes`);
  }
  return key;
}

function validateKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      "Runtime token key IDs must contain only letters, numbers, dot, underscore, or hyphen",
    );
  }
}

export function loadRuntimeTokenKeyring(
  env: RuntimeTokenCryptoEnv = process.env,
): RuntimeTokenKeyring {
  const keys = new Map<string, Buffer>();
  const authSecret = env.AUTH_SECRET?.trim();
  if (authSecret) keys.set(AUTH_SECRET_KEY_ID, derivedAuthSecretKey(authSecret));

  const configured = env.CREWCMD_RUNTIME_TOKEN_KEYS?.trim();
  let configuredKeyIds: string[] = [];
  if (configured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configured);
    } catch {
      throw new Error("CREWCMD_RUNTIME_TOKEN_KEYS must be a JSON object");
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("CREWCMD_RUNTIME_TOKEN_KEYS must be a JSON object");
    }
    configuredKeyIds = Object.keys(parsed);
    for (const [keyId, encoded] of Object.entries(parsed)) {
      validateKeyId(keyId);
      if (keyId === AUTH_SECRET_KEY_ID) {
        throw new Error(`Runtime token key ID "${AUTH_SECRET_KEY_ID}" is reserved`);
      }
      keys.set(keyId, decodeKey(keyId, encoded));
    }
  }

  const requestedActiveKeyId = env.CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID?.trim();
  let activeKeyId: string;
  if (requestedActiveKeyId) {
    validateKeyId(requestedActiveKeyId);
    activeKeyId = requestedActiveKeyId;
  } else if (configuredKeyIds.length === 1) {
    activeKeyId = configuredKeyIds[0];
  } else if (configuredKeyIds.length > 1) {
    throw new Error(
      "CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID is required when multiple runtime token keys are configured",
    );
  } else {
    activeKeyId = AUTH_SECRET_KEY_ID;
  }

  if (!keys.has(activeKeyId)) {
    throw new Error(`Active runtime token key "${activeKeyId}" is not configured`);
  }

  return { activeKeyId, keys };
}

function additionalData(keyId: string): Buffer {
  return Buffer.from(`${ENVELOPE_PREFIX}:${keyId}`, "utf8");
}

export function isEncryptedRuntimeAuthToken(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}:`);
}

export function getRuntimeAuthTokenKeyId(value: string): string | null {
  if (!isEncryptedRuntimeAuthToken(value)) return null;
  return value.split(":", 4)[3] || null;
}

export function encryptRuntimeAuthToken(
  plaintext: string,
  keyring: RuntimeTokenKeyring = loadRuntimeTokenKeyring(),
): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error(`Active runtime token key "${keyring.activeKeyId}" is not configured`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(keyring.activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    keyring.activeKeyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptRuntimeAuthToken(
  storedValue: string,
  options: {
    keyring?: RuntimeTokenKeyring;
    allowLegacyPlaintext?: boolean;
  } = {},
): string {
  if (!isEncryptedRuntimeAuthToken(storedValue)) {
    if (options.allowLegacyPlaintext) return storedValue;
    throw new Error(
      "Legacy plaintext runtime token rejected; run the runtime token migration before starting CrewCMD",
    );
  }

  const parts = storedValue.split(":");
  if (parts.length !== 7) throw new Error("Runtime token ciphertext is malformed");
  const [, , , keyId, encodedIv, encodedTag, encodedCiphertext] = parts;
  validateKeyId(keyId);

  const keyring = options.keyring ?? loadRuntimeTokenKeyring();
  const key = keyring.keys.get(keyId);
  if (!key) throw new Error(`Runtime token key "${keyId}" is not configured`);

  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error("invalid envelope lengths");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additionalData(keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Runtime token decryption failed");
  }
}

export function decryptRuntimeAuthTokenFromStorage(
  storedValue: string,
  env: RuntimeTokenCryptoEnv = process.env,
): string {
  return decryptRuntimeAuthToken(storedValue, {
    keyring: loadRuntimeTokenKeyring(env),
  });
}

export function sealRuntimeAuthToken(
  plaintext: string | null | undefined,
  env: RuntimeTokenCryptoEnv = process.env,
): string | null {
  if (!plaintext) return null;
  return encryptRuntimeAuthToken(plaintext, loadRuntimeTokenKeyring(env));
}

export function openRuntimeAuthToken(
  storedValue: string | null | undefined,
  env: RuntimeTokenCryptoEnv = process.env,
): string | null {
  if (!storedValue) return null;
  return decryptRuntimeAuthTokenFromStorage(storedValue, env);
}

/**
 * Resolves a token at a server-side network boundary. Versioned ciphertext is
 * always authenticated and decrypted; unversioned values remain readable only
 * so operators can migrate legacy rows without a flag-day outage.
 */
export function resolveRuntimeAuthTokenForUse(
  storedOrEphemeralValue: string | null | undefined,
  env: RuntimeTokenCryptoEnv = process.env,
): string | null {
  if (!storedOrEphemeralValue) return null;
  return isEncryptedRuntimeAuthToken(storedOrEphemeralValue)
    ? decryptRuntimeAuthTokenFromStorage(storedOrEphemeralValue, env)
    : storedOrEphemeralValue;
}
