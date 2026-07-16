export const CREWCMD_REALTIME_VOICE_TRANSPORT = "gateway-relay";

export type RealtimeVoiceReadinessStatus =
  | "disabled"
  | "provider-missing"
  | "unsupported-transport"
  | "unreachable"
  | "microphone-denied"
  | "ready";

export interface TalkCatalogProvider {
  id: string;
  label?: string;
  configured?: boolean;
  aliases?: string[];
  transports?: string[];
}

export interface TalkCatalogProviderGroup {
  ready?: boolean;
  activeProvider?: string;
  providers?: TalkCatalogProvider[];
}

export interface TalkCatalogReadinessSource {
  realtime?: TalkCatalogProviderGroup;
}

export interface RealtimeVoiceReadiness {
  status: RealtimeVoiceReadinessStatus;
  message: string;
  fallback: "classic-stt-tts";
  transport: typeof CREWCMD_REALTIME_VOICE_TRANSPORT;
  provider: string | null;
  availableTransports: string[];
  protocolVerified: boolean;
}

export function deriveRealtimeVoiceReadiness(params: {
  enabled: boolean;
  catalog?: TalkCatalogReadinessSource | null;
  requestedProvider?: string | null;
}): RealtimeVoiceReadiness {
  if (!params.enabled) {
    return readiness({
      status: "disabled",
      message:
        "Realtime voice is disabled. Set NEXT_PUBLIC_CREWCMD_REALTIME_VOICE=1 and rebuild or restart CrewCMD.",
    });
  }

  const group = params.catalog?.realtime;
  const providers = group?.providers ?? [];
  const requestedProvider = normalizeProviderId(params.requestedProvider);
  const activeProvider = normalizeProviderId(group?.activeProvider);
  const selected = requestedProvider
    ? providers.find((provider) => providerMatches(provider, requestedProvider))
    : providers.find((provider) => providerMatches(provider, activeProvider));
  const protocolVerified = typeof group?.ready === "boolean";

  if (group?.ready === false) {
    return readiness({
      status: "provider-missing",
      message:
        "OpenClaw reports that no runtime-selected realtime voice provider is ready. Configure talk.realtime in OpenClaw and retry.",
      provider: requestedProvider ?? activeProvider,
      protocolVerified,
    });
  }

  if (!selected) {
    const provider = requestedProvider ?? activeProvider;
    return readiness({
      status: "provider-missing",
      message: provider
        ? `OpenClaw does not expose a configured realtime voice provider matching ${provider}.`
        : "OpenClaw has no runtime-selected realtime voice provider. Configure talk.realtime and retry.",
      provider,
      protocolVerified,
    });
  }

  if (selected.configured !== true) {
    return readiness({
      status: "provider-missing",
      message: `${selected.label ?? selected.id} is selected for realtime voice but is not configured in OpenClaw.`,
      provider: selected.id,
      protocolVerified,
    });
  }

  const transports = uniqueStrings(selected.transports ?? []);
  if (!transports.includes(CREWCMD_REALTIME_VOICE_TRANSPORT)) {
    return readiness({
      status: "unsupported-transport",
      message: `${selected.label ?? selected.id} is configured, but it does not expose the gateway-relay transport required by CrewCMD.`,
      provider: selected.id,
      availableTransports: transports,
      protocolVerified,
    });
  }

  return readiness({
    status: "ready",
    message: protocolVerified
      ? `${selected.label ?? selected.id} is ready for realtime voice through OpenClaw gateway relay.`
      : `${selected.label ?? selected.id} exposes a configured gateway relay. This older OpenClaw catalog predates authoritative readiness, so session creation remains the final probe.`,
    provider: selected.id,
    availableTransports: transports,
    protocolVerified,
  });
}

export function unreachableRealtimeVoiceReadiness(message?: string): RealtimeVoiceReadiness {
  return readiness({
    status: "unreachable",
    message: message?.trim()
      ? `CrewCMD could not reach the selected OpenClaw runtime: ${message.trim()}`
      : "CrewCMD could not reach the selected OpenClaw runtime.",
  });
}

export function microphoneDeniedRealtimeVoiceReadiness(
  current: RealtimeVoiceReadiness,
): RealtimeVoiceReadiness {
  return {
    ...current,
    status: "microphone-denied",
    message: "Microphone access is denied. Allow microphone access for this site and retry.",
  };
}

function readiness(
  params: Pick<RealtimeVoiceReadiness, "status" | "message"> &
    Partial<Omit<RealtimeVoiceReadiness, "status" | "message">>,
): RealtimeVoiceReadiness {
  return {
    status: params.status,
    message: params.message,
    fallback: "classic-stt-tts",
    transport: CREWCMD_REALTIME_VOICE_TRANSPORT,
    provider: params.provider ?? null,
    availableTransports: params.availableTransports ?? [],
    protocolVerified: params.protocolVerified ?? false,
  };
}

function providerMatches(provider: TalkCatalogProvider, candidate: string | null) {
  if (!candidate) return false;
  return [provider.id, ...(provider.aliases ?? [])]
    .some((value) => normalizeProviderId(value) === candidate);
}

function normalizeProviderId(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
