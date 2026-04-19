import type { BlueprintAgentTemplate } from "@/db/schema";
import type { CrewCmdRolePack } from "./operating-layer";
import type { RuntimeCapabilitySnapshot } from "./runtime-capabilities";

export type CrewCmdModelProfile =
  | "orchestrator_reasoning"
  | "developer_primary"
  | "review_critic"
  | "research_deep"
  | "growth_execution"
  | "ops_fast";

export interface ResolvedModelSelection {
  profile: CrewCmdModelProfile;
  fallbackProfiles: CrewCmdModelProfile[];
  primaryModel: string | null;
  fallbackModels: string[];
  status: "resolved" | "partial" | "missing";
}

export interface AgentModelAssessment {
  profile: CrewCmdModelProfile;
  fallbackProfiles: CrewCmdModelProfile[];
  currentModel: string | null;
  recommendedModel: string | null;
  fallbackModels: string[];
  status: "matched" | "acceptable" | "needs_review" | "unresolved";
}

const MODEL_PROFILE_LABELS: Record<CrewCmdModelProfile, string> = {
  orchestrator_reasoning: "Orchestrator Reasoning",
  developer_primary: "Developer Primary",
  review_critic: "Review Critic",
  research_deep: "Research Deep",
  growth_execution: "Growth Execution",
  ops_fast: "Ops Fast",
};

const MODEL_PROFILE_PROVIDER_PREFERENCES: Record<CrewCmdModelProfile, string[]> = {
  orchestrator_reasoning: ["openai-codex", "anthropic", "openrouter"],
  developer_primary: ["openai-codex", "openrouter", "anthropic"],
  review_critic: ["anthropic", "openai-codex", "openrouter"],
  research_deep: ["openrouter", "anthropic", "openai-codex"],
  growth_execution: ["openrouter", "openai-codex", "anthropic"],
  ops_fast: ["openai-codex", "openrouter", "anthropic"],
};

export function labelModelProfile(profile: CrewCmdModelProfile): string {
  return MODEL_PROFILE_LABELS[profile];
}

export function defaultModelProfileForRolePack(rolePack: CrewCmdRolePack): CrewCmdModelProfile {
  switch (rolePack) {
    case "orchestrator":
      return "orchestrator_reasoning";
    case "developer":
      return "developer_primary";
    case "reviewer":
      return "review_critic";
    case "researcher":
      return "research_deep";
    case "growth":
      return "growth_execution";
    case "ops":
      return "ops_fast";
  }
}

export function normalizeModelProfile(value: string | null | undefined): CrewCmdModelProfile | null {
  if (!value) return null;
  return value in MODEL_PROFILE_LABELS ? (value as CrewCmdModelProfile) : null;
}

export function resolveBlueprintAgentModelSelection(
  agent: Pick<BlueprintAgentTemplate, "model" | "modelProfile" | "fallbackProfiles" | "rolePack">,
  runtimeCapabilities?: RuntimeCapabilitySnapshot | null
): ResolvedModelSelection {
  const rolePack = (agent.rolePack ?? "developer") as CrewCmdRolePack;
  const profile = normalizeModelProfile(agent.modelProfile) ?? defaultModelProfileForRolePack(rolePack);
  const fallbackProfiles = (agent.fallbackProfiles ?? [])
    .map((value) => normalizeModelProfile(value))
    .filter((value): value is CrewCmdModelProfile => value !== null);

  if (!runtimeCapabilities) {
    return {
      profile,
      fallbackProfiles,
      primaryModel: agent.model ?? null,
      fallbackModels: [],
      status: agent.model ? "partial" : "missing",
    };
  }

  const primaryModel = resolvePrimaryModel(profile, runtimeCapabilities) ?? agent.model ?? null;
  const fallbackModels = resolveFallbackModels(profile, fallbackProfiles, runtimeCapabilities, primaryModel);

  return {
    profile,
    fallbackProfiles,
    primaryModel,
    fallbackModels,
    status: primaryModel ? "resolved" : fallbackModels.length > 0 ? "partial" : "missing",
  };
}

export function assessAgentModelSelection(agent: {
  model?: string | null;
  modelProfile?: string | null;
  fallbackProfiles?: string[] | null;
  rolePack?: string | null;
} , runtimeCapabilities?: RuntimeCapabilitySnapshot | null): AgentModelAssessment {
  const rolePack = normalizeRolePack(agent.rolePack);
  const profile = normalizeModelProfile(agent.modelProfile) ?? defaultModelProfileForRolePack(rolePack);
  const fallbackProfiles = (agent.fallbackProfiles ?? [])
    .map((value) => normalizeModelProfile(value))
    .filter((value): value is CrewCmdModelProfile => value !== null);
  const resolved = resolveBlueprintAgentModelSelection(
    {
      model: agent.model ?? undefined,
      modelProfile: profile,
      fallbackProfiles,
      rolePack,
    },
    runtimeCapabilities
  );
  const currentModel = agent.model ?? null;
  const acceptableModels = new Set<string>(
    [resolved.primaryModel, ...resolved.fallbackModels].filter((value): value is string => Boolean(value))
  );

  let status: AgentModelAssessment["status"] = "unresolved";
  if (currentModel && resolved.primaryModel && currentModel === resolved.primaryModel) {
    status = "matched";
  } else if (currentModel && acceptableModels.has(currentModel)) {
    status = "acceptable";
  } else if (resolved.primaryModel) {
    status = "needs_review";
  }

  return {
    profile: resolved.profile,
    fallbackProfiles: resolved.fallbackProfiles,
    currentModel,
    recommendedModel: resolved.primaryModel,
    fallbackModels: resolved.fallbackModels,
    status,
  };
}

export function listSupportedModelProfiles(runtimeCapabilities?: RuntimeCapabilitySnapshot | null): CrewCmdModelProfile[] {
  if (!runtimeCapabilities) return [];
  return (Object.keys(MODEL_PROFILE_LABELS) as CrewCmdModelProfile[]).filter((profile) =>
    Boolean(resolvePrimaryModel(profile, runtimeCapabilities))
  );
}

function resolvePrimaryModel(
  profile: CrewCmdModelProfile,
  runtimeCapabilities: RuntimeCapabilitySnapshot
): string | null {
  const candidates = prioritizeModels(profile, runtimeCapabilities);
  return candidates[0] ?? null;
}

function resolveFallbackModels(
  profile: CrewCmdModelProfile,
  fallbackProfiles: CrewCmdModelProfile[],
  runtimeCapabilities: RuntimeCapabilitySnapshot,
  primaryModel: string | null
): string[] {
  const orderedProfiles = fallbackProfiles.length > 0 ? fallbackProfiles : [profile];
  const seen = new Set<string>(primaryModel ? [primaryModel] : []);
  const fallbacks: string[] = [];

  for (const fallbackProfile of orderedProfiles) {
    for (const model of prioritizeModels(fallbackProfile, runtimeCapabilities)) {
      if (seen.has(model)) continue;
      seen.add(model);
      fallbacks.push(model);
      if (fallbacks.length >= 3) {
        return fallbacks;
      }
    }
  }

  return fallbacks;
}

function prioritizeModels(
  profile: CrewCmdModelProfile,
  runtimeCapabilities: RuntimeCapabilitySnapshot
): string[] {
  const pool = Array.from(
    new Set([
      ...(runtimeCapabilities.primaryModels ?? []),
      ...(runtimeCapabilities.discoveredModels ?? []),
      ...(runtimeCapabilities.fallbackModels ?? []),
      ...(runtimeCapabilities.defaultModel ? [runtimeCapabilities.defaultModel] : []),
    ])
  );
  const providerOrder = MODEL_PROFILE_PROVIDER_PREFERENCES[profile];
  const scored = pool.map((model) => ({
    model,
    score: scoreModel(profile, model, providerOrder, runtimeCapabilities.defaultModel),
  }));

  return scored
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.model.localeCompare(b.model))
    .map((item) => item.model);
}

function scoreModel(
  profile: CrewCmdModelProfile,
  model: string,
  providerOrder: string[],
  defaultModel: string | null
): number {
  const provider = model.split("/")[0] ?? "";
  const providerIndex = providerOrder.indexOf(provider);
  let score = providerIndex === -1 ? -100 : 100 - providerIndex * 10;

  if (model === defaultModel) score += 6;
  if (/-mini\b/i.test(model)) score -= 8;

  if (profile === "review_critic" || profile === "orchestrator_reasoning" || profile === "research_deep") {
    if (/claude|sonnet|opus|gpt-5|reason/i.test(model)) score += 5;
  }

  if (profile === "developer_primary" || profile === "ops_fast") {
    if (/codex|gpt-5|qwen|m2\.5|minimax/i.test(model)) score += 5;
  }

  if (profile === "growth_execution") {
    if (/openrouter|gpt-5|claude/i.test(model)) score += 3;
  }

  return score;
}

function normalizeRolePack(value: string | null | undefined): CrewCmdRolePack {
  switch (value) {
    case "orchestrator":
    case "developer":
    case "reviewer":
    case "researcher":
    case "growth":
    case "ops":
      return value;
    default:
      return "developer";
  }
}
