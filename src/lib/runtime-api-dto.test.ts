import { describe, expect, it } from "vitest";
import { toBrowserSafeRuntime } from "./runtime-api-dto";

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
});
