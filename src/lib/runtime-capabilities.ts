import type { GatewayModel } from "./gateway-client";

export interface RuntimeAuthProfileSummary {
  id: string;
  provider: string;
  mode: string;
}

export interface RuntimeProviderSummary {
  id: string;
  configured: boolean;
  authModes: string[];
  hasModelProviderConfig: boolean;
  discoveredModelCount: number;
}

export interface RuntimeCapabilitySnapshot {
  detectedAt: string;
  providerCount: number;
  configuredProviders: RuntimeProviderSummary[];
  authProfiles: RuntimeAuthProfileSummary[];
  defaultModel: string | null;
  primaryModels: string[];
  fallbackModels: string[];
  discoveredModels: string[];
  uniqueSkillCount: number;
  uniqueSkills: string[];
  agentCount: number;
  acp: {
    enabled: boolean;
    defaultAgent: string | null;
    allowedAgents: string[];
  };
  realtimeVoice?: RuntimeRealtimeVoiceSummary;
}

export interface RuntimeRealtimeVoiceSummary {
  passthroughCandidate: boolean;
  likelyProviders: string[];
  configured: boolean;
  configuredProviders: string[];
  transports: string[];
  gatewayMethods: string[];
  notes: string[];
}

export function deriveRuntimeCapabilitySnapshot(params: {
  config: Record<string, unknown>;
  models?: GatewayModel[];
}): RuntimeCapabilitySnapshot {
  const detectedAt = new Date().toISOString();
  const authProfiles = readAuthProfiles(params.config);
  const agentEntries = readAgentEntries(params.config);
  const modelProviderIds = readStringKeys(readRecord(readRecord(params.config.models)?.providers));
  const discoveredModels = (params.models ?? []).map((model) => model.id);
  const modelProvidersFromList = new Map<string, number>();

  for (const model of params.models ?? []) {
    const count = modelProvidersFromList.get(model.provider) ?? 0;
    modelProvidersFromList.set(model.provider, count + 1);
  }

  const providerIds = new Set<string>();
  for (const profile of authProfiles) providerIds.add(profile.provider);
  for (const providerId of modelProviderIds) providerIds.add(providerId);
  for (const providerId of modelProvidersFromList.keys()) providerIds.add(providerId);

  const primaryModels: string[] = [];
  const fallbackModels: string[] = [];
  const uniqueSkills = new Set<string>();

  for (const agent of agentEntries) {
    const model = readRecord(agent.model);
    const primary = typeof model?.primary === "string" ? model.primary.trim() : "";
    if (primary) primaryModels.push(primary);
    const fallbacks = Array.isArray(model?.fallbacks)
      ? model.fallbacks.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    for (const fallback of fallbacks) fallbackModels.push(fallback);

    const skills = Array.isArray(agent.skills)
      ? agent.skills.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    for (const skill of skills) uniqueSkills.add(skill);
  }

  const providerSummaries: RuntimeProviderSummary[] = Array.from(providerIds)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const profileModes = authProfiles
        .filter((profile) => profile.provider === id)
        .map((profile) => profile.mode);
      const authModes = Array.from(new Set(profileModes)).sort((a, b) => a.localeCompare(b));
      return {
        id,
        configured: authModes.length > 0 || modelProviderIds.includes(id),
        authModes,
        hasModelProviderConfig: modelProviderIds.includes(id),
        discoveredModelCount: modelProvidersFromList.get(id) ?? 0,
      };
    });

  const modelsConfig = readRecord(params.config.models);
  const acp = readRecord(params.config.acp);

  return {
    detectedAt,
    providerCount: providerSummaries.length,
    configuredProviders: providerSummaries,
    authProfiles,
    defaultModel: typeof modelsConfig?.default === "string" ? modelsConfig.default : null,
    primaryModels: sortUnique(primaryModels),
    fallbackModels: sortUnique(fallbackModels),
    discoveredModels: sortUnique(discoveredModels),
    uniqueSkillCount: uniqueSkills.size,
    uniqueSkills: Array.from(uniqueSkills).sort((a, b) => a.localeCompare(b)),
    agentCount: agentEntries.length,
    acp: {
      enabled: acp?.enabled === true,
      defaultAgent: typeof acp?.defaultAgent === "string" ? acp.defaultAgent : null,
      allowedAgents: Array.isArray(acp?.allowedAgents)
        ? acp.allowedAgents.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
    },
    realtimeVoice: deriveRealtimeVoiceSummary({
      config: params.config,
      providerSummaries,
    }),
  };
}

function deriveRealtimeVoiceSummary(params: {
  config: Record<string, unknown>;
  providerSummaries: RuntimeProviderSummary[];
}): RuntimeRealtimeVoiceSummary {
  const realtimeConfig = readRecord(readRecord(params.config.talk)?.realtime)
    ?? readRecord(readRecord(params.config["voice-call"])?.realtime)
    ?? readRecord(readRecord(params.config.voice)?.realtime);
  const configuredProviders = readConfiguredRealtimeProviders(realtimeConfig);
  const providerIds = params.providerSummaries.map((provider) => provider.id);
  const likelyProviders = providerIds.filter((providerId) =>
    ["openai", "google"].includes(providerId.toLowerCase())
  );

  return {
    passthroughCandidate: likelyProviders.length > 0 || configuredProviders.length > 0,
    likelyProviders,
    configured: configuredProviders.length > 0 || realtimeConfig?.enabled === true,
    configuredProviders,
    transports: ["webrtc-sdp", "json-pcm-websocket", "gateway-relay"],
    gatewayMethods: [
      "talk.session.create",
      "talk.session.appendAudio",
      "talk.session.submitToolResult",
      "talk.session.close",
      "talk.event",
    ],
    notes: [
      "Capability is config-derived only; route-level probing still determines whether the selected runtime accepts realtime talk sessions.",
    ],
  };
}

function readConfiguredRealtimeProviders(config: Record<string, unknown> | null): string[] {
  if (!config) return [];

  const providers = config.providers;
  if (Array.isArray(providers)) {
    return sortUnique(providers.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
  }
  if (typeof config.provider === "string" && config.provider.trim()) {
    return [config.provider.trim()];
  }
  return readStringKeys(readRecord(providers));
}

function readAuthProfiles(config: Record<string, unknown>): RuntimeAuthProfileSummary[] {
  const authProfiles = readRecord(readRecord(config.auth)?.profiles);
  if (!authProfiles) return [];

  return Object.entries(authProfiles)
    .map(([id, value]) => {
      const profile = readRecord(value);
      const provider = typeof profile?.provider === "string" ? profile.provider : "";
      const mode = typeof profile?.mode === "string" ? profile.mode : "";
      if (!provider || !mode) return null;
      return { id, provider, mode };
    })
    .filter((value): value is RuntimeAuthProfileSummary => value !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readAgentEntries(config: Record<string, unknown>): Record<string, unknown>[] {
  const list = readRecord(config.agents)?.list;
  if (!Array.isArray(list)) return [];
  return list.filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringKeys(value: Record<string, unknown> | null): string[] {
  return value ? Object.keys(value) : [];
}

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
