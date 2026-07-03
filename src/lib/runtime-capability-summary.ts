import { labelModelProfile, listSupportedModelProfiles } from "@/lib/model-profiles";
import type { RuntimeCapabilitySnapshot } from "@/lib/runtime-capabilities";

export interface RuntimeCapabilitySummary {
  primary: string;
  secondary: string | null;
  modelProfiles: string[];
}

export function labelRuntimeType(runtimeType: string) {
  if (runtimeType === "hermes") return "HERMES";
  if (runtimeType === "openclaw") return "OPENCLAW";
  return runtimeType.toUpperCase();
}

export function summarizeRuntimeCapabilities(capabilities: unknown): RuntimeCapabilitySummary | null {
  if (!isRecord(capabilities)) return null;

  if (isOpenClawCapabilitySnapshot(capabilities)) {
    return {
      primary: `${capabilities.providerCount} providers · default model ${capabilities.defaultModel || "not set"}`,
      secondary: null,
      modelProfiles: listSupportedModelProfiles(capabilities).map((profile) => labelModelProfile(profile).toUpperCase()),
    };
  }

  const platform = typeof capabilities.platform === "string"
    ? capabilities.platform
    : typeof capabilities.object === "string"
      ? capabilities.object
      : "Runtime API";
  const features = isRecord(capabilities.features)
    ? Object.entries(capabilities.features)
        .filter(([, enabled]) => enabled === true)
        .map(([feature]) => feature.replace(/_/g, " "))
    : [];

  return {
    primary: features.length > 0 ? `${platform} · ${features.length} features` : platform,
    secondary: features.length > 0 ? `Features: ${features.join(", ")}` : null,
    modelProfiles: [],
  };
}

function isOpenClawCapabilitySnapshot(
  value: Record<string, unknown>
): value is RuntimeCapabilitySnapshot & Record<string, unknown> {
  return typeof value.providerCount === "number"
    && Array.isArray(value.configuredProviders)
    && Array.isArray(value.primaryModels)
    && Array.isArray(value.discoveredModels);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
