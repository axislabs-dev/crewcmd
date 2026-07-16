import { describe, expect, it } from "vitest";
import {
  decryptRuntimeAuthToken,
  decryptRuntimeAuthTokenFromStorage,
  encryptRuntimeAuthToken,
  getRuntimeAuthTokenKeyId,
  isEncryptedRuntimeAuthToken,
  loadRuntimeTokenKeyring,
  openRuntimeAuthToken,
  resolveRuntimeAuthTokenForUse,
  sealRuntimeAuthToken,
} from "./runtime-token-crypto";

const firstKey = Buffer.alloc(32, 1).toString("base64");
const secondKey = Buffer.alloc(32, 2).toString("base64");

function keyring(activeKeyId = "first") {
  return loadRuntimeTokenKeyring({
    CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ first: firstKey, second: secondKey }),
    CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID: activeKeyId,
  });
}

describe("runtime token encryption", () => {
  it("round-trips with randomized, versioned AES-GCM envelopes", () => {
    const first = encryptRuntimeAuthToken("very-secret", keyring());
    const second = encryptRuntimeAuthToken("very-secret", keyring());

    expect(first).not.toBe(second);
    expect(first).not.toContain("very-secret");
    expect(isEncryptedRuntimeAuthToken(first)).toBe(true);
    expect(getRuntimeAuthTokenKeyId(first)).toBe("first");
    expect(decryptRuntimeAuthToken(first, { keyring: keyring() })).toBe("very-secret");
  });

  it("fails closed for tampered ciphertext without exposing plaintext", () => {
    const encrypted = encryptRuntimeAuthToken("never-log-me", keyring());
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => decryptRuntimeAuthToken(tampered, { keyring: keyring() })).toThrow(
      "Runtime token decryption failed",
    );
    try {
      decryptRuntimeAuthToken(tampered, { keyring: keyring() });
    } catch (error) {
      expect(String(error)).not.toContain("never-log-me");
    }
  });

  it("fails closed when the ciphertext key is unavailable", () => {
    const encrypted = encryptRuntimeAuthToken("secret", keyring("first"));
    const rotated = loadRuntimeTokenKeyring({
      CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ second: secondKey }),
    });

    expect(() => decryptRuntimeAuthToken(encrypted, { keyring: rotated })).toThrow(
      'Runtime token key "first" is not configured',
    );
  });

  it("rejects plaintext in the strict storage-opening API", () => {
    expect(() => decryptRuntimeAuthTokenFromStorage("legacy-secret", {
      AUTH_SECRET: "test-auth-secret",
    })).toThrow("Legacy plaintext runtime token rejected");

    expect(decryptRuntimeAuthToken("legacy-secret", {
      keyring: keyring(),
      allowLegacyPlaintext: true,
    })).toBe("legacy-secret");
  });

  it("uses a dedicated key in preference to the AUTH_SECRET compatibility key", () => {
    const configured = loadRuntimeTokenKeyring({
      AUTH_SECRET: "existing-auth-secret",
      CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ current: firstKey }),
    });

    expect(configured.activeKeyId).toBe("current");
    expect(configured.keys.has("auth-secret-v1")).toBe(true);
    expect(decryptRuntimeAuthToken(
      encryptRuntimeAuthToken("secret", configured),
      { keyring: configured },
    )).toBe("secret");
  });

  it("requires an active key and valid 32-byte key material", () => {
    expect(() => loadRuntimeTokenKeyring({})).toThrow(
      'Active runtime token key "auth-secret-v1" is not configured',
    );
    expect(() => loadRuntimeTokenKeyring({
      CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ first: Buffer.alloc(16).toString("base64") }),
    })).toThrow("must decode to exactly 32 bytes");
    expect(() => loadRuntimeTokenKeyring({
      CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ first: firstKey, second: secondKey }),
    })).toThrow("CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID is required");
  });

  it("seals and opens nullable storage values without importing crypto into the schema", () => {
    const env = { AUTH_SECRET: "storage-helper-secret" };
    const stored = sealRuntimeAuthToken("gateway-secret", env);

    expect(stored).not.toBeNull();
    expect(stored).not.toContain("gateway-secret");
    expect(openRuntimeAuthToken(stored, env)).toBe("gateway-secret");
    expect(sealRuntimeAuthToken(null, env)).toBeNull();
    expect(openRuntimeAuthToken(null, env)).toBeNull();
  });

  it("resolves encrypted and legacy tokens only at server-side use boundaries", () => {
    const env = { AUTH_SECRET: "network-boundary-secret" };
    const stored = sealRuntimeAuthToken("gateway-secret", env);

    expect(resolveRuntimeAuthTokenForUse(stored, env)).toBe("gateway-secret");
    expect(resolveRuntimeAuthTokenForUse("legacy-gateway-secret", env)).toBe(
      "legacy-gateway-secret",
    );
    expect(resolveRuntimeAuthTokenForUse(null, env)).toBeNull();
  });
});
