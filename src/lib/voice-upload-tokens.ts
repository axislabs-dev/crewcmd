import { randomBytes, timingSafeEqual } from "node:crypto";

type VoiceUploadToken = {
  tokenHash: Buffer;
  expiresAt: number;
};

declare global {
  var crewCmdVoiceUploadTokens: Map<string, VoiceUploadToken> | undefined;
}

const TOKEN_PREFIX = "crewcmd_voice_";
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_BYTES = 32;

function getStore() {
  globalThis.crewCmdVoiceUploadTokens ??= new Map();
  return globalThis.crewCmdVoiceUploadTokens;
}

function hashToken(token: string) {
  return Buffer.from(token, "utf8");
}

export function createVoiceUploadToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const store = getStore();

  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= Date.now()) {
      store.delete(key);
    }
  }

  store.set(token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 16), { tokenHash, expiresAt });
  return { token, expiresAt };
}

export function isValidVoiceUploadToken(token: string | null | undefined) {
  if (!token?.startsWith(TOKEN_PREFIX)) return false;

  const store = getStore();
  const lookupKey = token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 16);
  const stored = store.get(lookupKey);
  if (!stored) return false;
  if (stored.expiresAt <= Date.now()) {
    store.delete(lookupKey);
    return false;
  }

  const provided = hashToken(token);
  return provided.byteLength === stored.tokenHash.byteLength && timingSafeEqual(provided, stored.tokenHash);
}
