import { describe, expect, it } from "vitest";
import { toBrowserSafeRuntime, toBrowserSafeRuntimeMetadata } from "./runtime-api-dto";

describe("runtime API DTO", () => {
  it("replaces stored ciphertext with a non-sensitive configured flag", () => {
    const dto = toBrowserSafeRuntime({
      id: "runtime-1",
      name: "OpenClaw",
      authToken: "crewcmd:runtime-token:v1:key:iv:tag:ciphertext",
    });

    expect(dto).toEqual({
      id: "runtime-1",
      name: "OpenClaw",
      hasAuthToken: true,
    });
    expect(dto).not.toHaveProperty("authToken");
    expect(JSON.stringify(dto)).not.toContain("ciphertext");
  });

  it("reports missing credentials without adding a secret field", () => {
    expect(toBrowserSafeRuntime({ id: "runtime-2", authToken: null })).toEqual({
      id: "runtime-2",
      hasAuthToken: false,
    });
  });

  it("removes device authentication secrets from runtime metadata", () => {
    const dto = toBrowserSafeRuntime({
      id: "runtime-3",
      authToken: "shared-token-ciphertext",
      metadata: {
        workspaceId: "workspace-1",
        devicePrivateKeyPem: "private-key-ciphertext",
        openclawDeviceAuth: {
          tokenCiphertext: "device-token-ciphertext",
        },
      },
    });

    expect(dto).toEqual({
      id: "runtime-3",
      hasAuthToken: true,
      metadata: { workspaceId: "workspace-1" },
    });
    expect(JSON.stringify(dto)).not.toContain("private-key-ciphertext");
    expect(JSON.stringify(dto)).not.toContain("device-token-ciphertext");
  });

  it("sanitizes metadata selected without the runtime token column", () => {
    expect(toBrowserSafeRuntimeMetadata({
      label: "local",
      devicePrivateKeyPem: "private-key",
      openclawDeviceAuth: { tokenCiphertext: "device-token" },
    })).toEqual({ label: "local" });
  });
});
