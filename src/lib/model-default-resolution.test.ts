import { describe, expect, it } from "vitest";
import { normalizeModel, resolveModelDefault } from "./model-default-resolution";

describe("resolveModelDefault", () => {
  it("prioritizes agent overrides over company and runtime defaults", () => {
    expect(resolveModelDefault({
      agentOverride: "anthropic/claude-sonnet-4-6",
      companyDefault: "openai-codex/gpt-5",
      runtimeDefault: "openrouter/qwen3-coder",
    })).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      source: "agent_override",
    });
  });

  it("falls back to company defaults before runtime defaults", () => {
    expect(resolveModelDefault({
      companyDefault: "openai-codex/gpt-5",
      runtimeDefault: "openrouter/qwen3-coder",
    })).toEqual({
      model: "openai-codex/gpt-5",
      source: "company_default",
    });
  });

  it("uses the runtime default when no explicit defaults exist", () => {
    expect(resolveModelDefault({
      runtimeDefault: "openrouter/qwen3-coder",
    })).toEqual({
      model: "openrouter/qwen3-coder",
      source: "runtime_default",
    });
  });

  it("returns unresolved when no usable model exists", () => {
    expect(resolveModelDefault({
      agentOverride: " ",
      companyDefault: "",
      runtimeDefault: null,
    })).toEqual({
      model: null,
      source: "unresolved",
    });
  });
});

describe("normalizeModel", () => {
  it("trims non-empty model identifiers", () => {
    expect(normalizeModel(" openai-codex/gpt-5 ")).toBe("openai-codex/gpt-5");
  });

  it("rejects empty values", () => {
    expect(normalizeModel(" ")).toBeNull();
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel(undefined)).toBeNull();
  });
});
