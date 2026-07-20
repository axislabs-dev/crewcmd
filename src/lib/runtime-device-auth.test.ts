import { describe, expect, it } from "vitest";
import {
  clearRuntimeDeviceAuth,
  readRuntimeDeviceAuth,
  removeRuntimeAuthSecretsFromMetadata,
  sealRuntimeDevicePrivateKey,
  storeRuntimeDeviceAuth,
} from "./runtime-device-auth";
import { isEncryptedRuntimeAuthToken, resolveRuntimeAuthTokenForUse } from "./runtime-token-crypto";

const cryptoEnv = { AUTH_SECRET: "runtime-device-auth-test-secret" };

describe("runtime device authentication metadata", () => {
  it("round-trips an encrypted device credential for the expected identity", () => {
    const metadata = storeRuntimeDeviceAuth(
      { workspaceId: "workspace-1" },
      "device-1",
      {
        token: "device-token",
        role: "operator",
        scopes: ["operator.write", "operator.read", "operator.read"],
      },
      cryptoEnv,
    );

    expect(metadata.workspaceId).toBe("workspace-1");
    expect(metadata.openclawDeviceAuth).toMatchObject({
      version: 1,
      deviceId: "device-1",
      role: "operator",
      scopes: ["operator.write", "operator.read"],
    });
    expect(JSON.stringify(metadata)).not.toContain("device-token");
    expect(readRuntimeDeviceAuth(metadata, "device-1", cryptoEnv)).toEqual({
      token: "device-token",
      role: "operator",
      scopes: ["operator.write", "operator.read"],
    });
    expect(readRuntimeDeviceAuth(metadata, "different-device", cryptoEnv)).toBeNull();
  });

  it("clears only the device credential", () => {
    const metadata = storeRuntimeDeviceAuth(
      { workspaceId: "workspace-1" },
      "device-1",
      { token: "device-token", role: "operator", scopes: ["operator.read"] },
      cryptoEnv,
    );

    expect(clearRuntimeDeviceAuth(metadata)).toEqual({ workspaceId: "workspace-1" });
  });

  it("seals device private keys once", () => {
    const sealed = sealRuntimeDevicePrivateKey("private-key-pem", cryptoEnv);

    expect(isEncryptedRuntimeAuthToken(sealed)).toBe(true);
    expect(resolveRuntimeAuthTokenForUse(sealed, cryptoEnv)).toBe("private-key-pem");
    expect(sealRuntimeDevicePrivateKey(sealed, cryptoEnv)).toBe(sealed);
  });

  it("removes device secrets from browser-facing metadata", () => {
    expect(removeRuntimeAuthSecretsFromMetadata({
      workspaceId: "workspace-1",
      devicePrivateKeyPem: "private-key",
      openclawDeviceAuth: { tokenCiphertext: "ciphertext" },
    })).toEqual({ workspaceId: "workspace-1" });
    expect(removeRuntimeAuthSecretsFromMetadata(null)).toBeNull();
  });
});
