import { describe, expect, it } from "vitest";
import { sanitizeConfig, toPublicAgentDto } from "./agent-public-dto";

describe("toPublicAgentDto", () => {
  it("removes credential-shaped adapter and runtime configuration recursively", () => {
    const dto = toPublicAgentDto({
      id: "agent-1",
      adapterConfig: {
        url: "https://user:password@example.com/v1?token=query-secret&mode=fast",
        headers: {
          Authorization: "Bearer runtime-secret",
          "X-Custom": "also-private",
        },
        requestHeaders: { "X-Provider-Token": "header-secret" },
        envVars: { PUBLIC_MODE: "fast", OPENAI_API_KEY: "env-secret" },
        apiKey: "provider-secret",
        customToken: "custom-secret",
        accessKey: "access-secret",
        sessionKey: "session-secret",
        timeoutSec: 60,
        nested: {
          clientSecret: "nested-secret",
          retries: 2,
        },
      },
      runtimeConfig: {
        heartbeat: { enabled: true },
        authToken: "runtime-secret",
        signing_key: "signing-secret",
      },
    });

    expect(dto).toEqual({
      id: "agent-1",
      adapterConfig: {
        url: "https://example.com/v1?mode=fast",
        timeoutSec: 60,
        nested: { retries: 2 },
      },
      runtimeConfig: {
        heartbeat: { enabled: true },
      },
    });

    expect(JSON.stringify(dto)).not.toContain("secret");
    expect(JSON.stringify(dto)).not.toContain("password");
  });

  it("sanitizes credential-shaped fields inside arrays", () => {
    expect(sanitizeConfig({
      providers: [
        { name: "primary", accessToken: "secret", enabled: true },
        { name: "fallback", password: "secret", enabled: false },
      ],
    })).toEqual({
      providers: [
        { name: "primary", enabled: true },
        { name: "fallback", enabled: false },
      ],
    });
  });

  it("drops unparseable URL-like values that may contain credentials", () => {
    expect(sanitizeConfig({
      url: "not a url?token=secret",
      callbackUrl: "relative@secret",
      label: "safe",
    })).toEqual({ label: "safe" });
  });
});
