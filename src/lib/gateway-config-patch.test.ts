import { describe, expect, it } from "vitest";
import {
  mapGatewayConfigPatchConflict,
  mapGatewayConfigPatchError,
  normalizeGatewayConfigPatchRequest,
  summarizeGatewayConfigPatch,
} from "./gateway-config-patch";

describe("normalizeGatewayConfigPatchRequest", () => {
  it("rejects non-object requests and non-object patches", () => {
    expect(normalizeGatewayConfigPatchRequest(null)).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_patch_request",
          message: "Config patch request must be an object.",
          field: "request",
        },
      ],
    });

    expect(normalizeGatewayConfigPatchRequest({ patch: [] })).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_config_patch",
          message: "Config patch must be an object.",
          field: "patch",
        },
      ],
    });
  });

  it("rejects empty patches", () => {
    expect(normalizeGatewayConfigPatchRequest({ patch: {} })).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_config_patch",
          message: "Config patch must include at least one top-level key.",
          field: "patch",
        },
      ],
    });
  });

  it("normalizes optional base hash and note metadata", () => {
    const result = normalizeGatewayConfigPatchRequest({
      patch: { agents: { list: [{ id: "main", name: "Main" }] } },
      baseHash: "  hash-1  ",
      note: "  CrewCmd updated main  ",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        baseHash: "hash-1",
        note: "CrewCmd updated main",
        summary: {
          topLevelKeys: ["agents"],
          changedPaths: ["agents.list[0].id", "agents.list[0].name"],
        },
      },
    });
  });

  it("validates optional metadata types and lengths", () => {
    const result = normalizeGatewayConfigPatchRequest({
      patch: { models: { default: "gpt-5" } },
      baseHash: 42,
      note: "x".repeat(501),
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_base_hash",
          message: "Base hash must be a string when provided.",
          field: "baseHash",
        },
        {
          code: "invalid_patch_note",
          message: "Patch note must be 500 characters or fewer.",
          field: "note",
        },
      ],
    });
  });
});

describe("summarizeGatewayConfigPatch", () => {
  it("redacts sensitive fields while keeping reviewable shape", () => {
    const summary = summarizeGatewayConfigPatch({
      auth: {
        profiles: {
          openai: {
            apiKey: "sk-secret",
            mode: "env",
          },
        },
      },
      gateway: {
        token: "runtime-token",
        port: 7331,
      },
    });

    expect(summary).toEqual({
      topLevelKeys: ["auth", "gateway"],
      changedPaths: [
        "auth.profiles.openai.apiKey",
        "auth.profiles.openai.mode",
        "gateway.token",
        "gateway.port",
      ],
      redactedPatch: {
        auth: "[redacted]",
        gateway: {
          token: "[redacted]",
          port: 7331,
        },
      },
      redactedPathCount: 2,
    });
  });
});

describe("gateway config patch error mapping", () => {
  it("maps conflicts to a stable response", () => {
    expect(mapGatewayConfigPatchConflict({ baseHash: "old" })).toEqual({
      status: 409,
      code: "config_patch_conflict",
      message: "Runtime config changed before this patch could be applied. Refresh and retry.",
      details: { baseHash: "old" },
    });
  });

  it("detects base hash errors as conflicts", () => {
    expect(mapGatewayConfigPatchError(new Error("base hash mismatch"))).toEqual({
      status: 409,
      code: "config_patch_conflict",
      message: "Runtime config changed before this patch could be applied. Refresh and retry.",
      details: { message: "base hash mismatch" },
    });
  });

  it("maps unknown failures to gateway patch failures", () => {
    expect(mapGatewayConfigPatchError({ status: 503, message: "gateway unavailable" })).toEqual({
      status: 503,
      code: "config_patch_failed",
      message: "gateway unavailable",
    });
  });
});
