import { describe, expect, it } from "vitest";
import {
  decryptRuntimeAuthToken,
  encryptRuntimeAuthToken,
  getRuntimeAuthTokenKeyId,
  loadRuntimeTokenKeyring,
} from "./runtime-token-crypto";
import { planRuntimeTokenMigration } from "./runtime-token-migration";

const oldKey = Buffer.alloc(32, 3).toString("base64");
const currentKey = Buffer.alloc(32, 4).toString("base64");
const keys = JSON.stringify({ old: oldKey, current: currentKey });
const oldKeyring = loadRuntimeTokenKeyring({
  CREWCMD_RUNTIME_TOKEN_KEYS: keys,
  CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID: "old",
});
const currentKeyring = loadRuntimeTokenKeyring({
  CREWCMD_RUNTIME_TOKEN_KEYS: keys,
  CREWCMD_RUNTIME_TOKEN_ACTIVE_KEY_ID: "current",
});

describe("runtime token migration planning", () => {
  it("plans plaintext migration and old-key rotation without returning plaintext", () => {
    const oldCiphertext = encryptRuntimeAuthToken("old-secret", oldKeyring);
    const currentCiphertext = encryptRuntimeAuthToken("current-secret", currentKeyring);
    const plan = planRuntimeTokenMigration([
      { id: "none", authToken: null },
      { id: "legacy", authToken: "legacy-secret" },
      { id: "old", authToken: oldCiphertext },
      { id: "current", authToken: currentCiphertext },
    ], currentKeyring);

    expect(plan.summary).toEqual({
      scanned: 4,
      withoutToken: 1,
      plaintext: 1,
      rotated: 1,
      current: 1,
      updates: 2,
    });
    expect(plan.updates.map((update) => update.id)).toEqual(["legacy", "old"]);
    for (const update of plan.updates) {
      expect(getRuntimeAuthTokenKeyId(update.encryptedAuthToken)).toBe("current");
    }
    expect(decryptRuntimeAuthToken(plan.updates[0].encryptedAuthToken, {
      keyring: currentKeyring,
    })).toBe("legacy-secret");
    expect(JSON.stringify(plan)).not.toContain("legacy-secret");
    expect(JSON.stringify(plan)).not.toContain("old-secret");
  });

  it("validates current ciphertext instead of silently skipping tampering", () => {
    const encrypted = encryptRuntimeAuthToken("secret", currentKeyring);
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => planRuntimeTokenMigration([
      { id: "tampered", authToken: tampered },
    ], currentKeyring)).toThrow("Runtime token decryption failed");
  });

  it("fails when an old rotation key was removed too early", () => {
    const encrypted = encryptRuntimeAuthToken("secret", oldKeyring);
    const currentOnly = loadRuntimeTokenKeyring({
      CREWCMD_RUNTIME_TOKEN_KEYS: JSON.stringify({ current: currentKey }),
    });

    expect(() => planRuntimeTokenMigration([
      { id: "old", authToken: encrypted },
    ], currentOnly)).toThrow('Runtime token key "old" is not configured');
  });
});
