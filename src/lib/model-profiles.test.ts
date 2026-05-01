import { describe, expect, it } from "vitest";
import { listModelProfileCatalog } from "./model-profiles";
import type { RuntimeCapabilitySnapshot } from "./runtime-capabilities";

const runtimeCapabilities: RuntimeCapabilitySnapshot = {
  detectedAt: "2026-05-01T00:00:00.000Z",
  providerCount: 2,
  configuredProviders: [],
  authProfiles: [],
  defaultModel: "openai-codex/gpt-5",
  primaryModels: [
    "openai-codex/gpt-5",
    "anthropic/claude-sonnet-4-6",
    "openrouter/deep-research",
  ],
  fallbackModels: ["openrouter/gpt-5-mini"],
  discoveredModels: [],
  uniqueSkillCount: 0,
  uniqueSkills: [],
  agentCount: 0,
  acp: {
    enabled: false,
    defaultAgent: null,
    allowedAgents: [],
  },
};

describe("listModelProfileCatalog", () => {
  it("returns every built-in model profile without runtime capabilities", () => {
    const catalog = listModelProfileCatalog();

    expect(catalog.map((entry) => entry.id)).toEqual([
      "orchestrator_reasoning",
      "developer_primary",
      "review_critic",
      "research_deep",
      "growth_execution",
      "ops_fast",
    ]);
    expect(catalog.every((entry) => entry.supported === false)).toBe(true);
    expect(catalog.every((entry) => entry.recommendedModel === null)).toBe(true);
  });

  it("adds runtime recommendations when capabilities are available", () => {
    const catalog = listModelProfileCatalog(runtimeCapabilities);

    const developer = catalog.find((entry) => entry.id === "developer_primary");
    const reviewer = catalog.find((entry) => entry.id === "review_critic");

    expect(developer).toMatchObject({
      label: "Developer Primary",
      supported: true,
      recommendedModel: "openai-codex/gpt-5",
    });
    expect(reviewer).toMatchObject({
      label: "Review Critic",
      supported: true,
      recommendedModel: "anthropic/claude-sonnet-4-6",
    });
    expect(developer?.providerPreferences).toEqual(["openai-codex", "openrouter", "anthropic"]);
  });
});
