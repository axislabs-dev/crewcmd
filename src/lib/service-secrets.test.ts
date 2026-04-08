import { describe, it, expect } from "vitest";
import { collectSecretRefNames, isSecretRefValue, toSecretMetadata } from "./service-secrets";

describe("service secret helpers", () => {
  it("detects valid secretRef values", () => {
    expect(isSecretRefValue({ secretRef: { name: "evercontent-api-key" } })).toBe(true);
    expect(isSecretRefValue({ secretRef: { name: "" } })).toBe(false);
    expect(isSecretRefValue({ nope: true })).toBe(false);
  });

  it("collects secretRef names recursively", () => {
    const names = [...collectSecretRefNames({
      apiKey: { secretRef: { name: "evercontent-api-key" } },
      nested: {
        token: { secretRef: { name: "cms-token" } },
      },
      list: [{ secretRef: { name: "asset-key" } }],
    })];

    expect(names.sort()).toEqual(["asset-key", "cms-token", "evercontent-api-key"]);
  });

  it("masks secret values in metadata responses", () => {
    expect(toSecretMetadata({
      id: "s1",
      name: "evercontent-api-key",
      description: "Primary key",
      value: "abcd1234",
      createdAt: new Date("2026-04-08T00:00:00Z"),
      updatedAt: new Date("2026-04-08T01:00:00Z"),
    })).toMatchObject({
      id: "s1",
      name: "evercontent-api-key",
      description: "Primary key",
      maskedValue: "****1234",
    });
  });
});
