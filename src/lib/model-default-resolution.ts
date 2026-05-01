export type ModelDefaultSource =
  | "agent_override"
  | "company_default"
  | "runtime_default"
  | "unresolved";

export interface ModelDefaultResolutionInput {
  agentOverride?: string | null;
  companyDefault?: string | null;
  runtimeDefault?: string | null;
}

export interface ModelDefaultResolution {
  model: string | null;
  source: ModelDefaultSource;
}

export function resolveModelDefault(input: ModelDefaultResolutionInput): ModelDefaultResolution {
  const agentOverride = normalizeModel(input.agentOverride);
  if (agentOverride) {
    return { model: agentOverride, source: "agent_override" };
  }

  const companyDefault = normalizeModel(input.companyDefault);
  if (companyDefault) {
    return { model: companyDefault, source: "company_default" };
  }

  const runtimeDefault = normalizeModel(input.runtimeDefault);
  if (runtimeDefault) {
    return { model: runtimeDefault, source: "runtime_default" };
  }

  return { model: null, source: "unresolved" };
}

export function normalizeModel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
