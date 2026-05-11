import { createAgentModeSessionId, publishAgentModeDiagnostic } from "@/lib/agent-mode-diagnostics";

export type NativeVoiceSessionState = "idle" | "listening" | "recording" | "transcribing" | "error";

export type NativeVoiceSessionStatus = {
  active: boolean;
  state: NativeVoiceSessionState;
  backgroundCapable: boolean;
  audioSessionActive: boolean;
  pendingChunks: number;
  currentTurnId?: string;
  lastError?: string | null;
};

export type NativeVoiceSessionAvailability = {
  available: boolean;
  platform: string;
  backgroundCapable: boolean;
};

export type NativeVoiceSessionStartOptions = {
  voiceSessionId?: string;
  baseUrl?: string;
  workspaceId?: string;
  sessionKey?: string;
  agentCallsign?: string;
  uploadToken?: string;
  muted?: boolean;
  agent?: string;
  gatewayAgent?: string;
  companyId?: string;
};

export type NativeVoiceTranscriptEvent = {
  voiceSessionId?: string;
  text?: string;
  provider?: string;
  error?: string;
};

export type NativeVoiceAudioPlaybackOptions = {
  dataBase64: string;
  contentType?: string;
  playbackRate?: number;
};

export type NativeVoiceSpeechOptions = {
  text: string;
  playbackRate?: number;
  voiceId?: string;
  voiceName?: string;
  language?: string;
};

type NativePluginHandle = { remove: () => Promise<void> };

type NativeVoiceSessionPlugin = {
  isAvailable?: () => Promise<NativeVoiceSessionAvailability>;
  start?: (options: NativeVoiceSessionStartOptions) => Promise<NativeVoiceSessionStatus>;
  stop?: () => Promise<NativeVoiceSessionStatus>;
  muteMic?: (options: { muted: boolean }) => Promise<NativeVoiceSessionStatus>;
  playAudio?: (options: NativeVoiceAudioPlaybackOptions) => Promise<NativeVoiceSessionStatus>;
  speakText?: (options: NativeVoiceSpeechOptions) => Promise<NativeVoiceSessionStatus>;
  stopAudio?: () => Promise<NativeVoiceSessionStatus>;
  status?: () => Promise<NativeVoiceSessionStatus>;
  addListener?: (eventName: string, listenerFunc: (event: Record<string, unknown>) => void) => Promise<NativePluginHandle>;
};

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
    registerPlugin?: (pluginName: string) => NativeVoiceSessionPlugin;
    Plugins?: {
      CrewCmdVoiceSession?: NativeVoiceSessionPlugin;
    };
  };
};

let registeredNativeVoiceSessionPlugin: NativeVoiceSessionPlugin | null | undefined;

function isNativeCapacitorShell() {
  if (typeof window === "undefined") return false;
  const capacitor = (window as CapacitorWindow).Capacitor;
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android";
}

function getNativeVoicePluginDebugDetail() {
  const capacitor = typeof window !== "undefined" ? (window as CapacitorWindow).Capacitor : undefined;
  return {
    platform: capacitor?.getPlatform?.() ?? "unknown",
    hasCapacitor: Boolean(capacitor),
    hasRegisterPlugin: typeof capacitor?.registerPlugin === "function",
    pluginKeys: Object.keys(capacitor?.Plugins ?? {}),
  };
}

export function getNativeVoiceSessionPlugin(): NativeVoiceSessionPlugin | null {
  if (typeof window === "undefined") return null;

  const capacitor = (window as CapacitorWindow).Capacitor;
  const plugin = capacitor?.Plugins?.CrewCmdVoiceSession;
  if (plugin) {
    registeredNativeVoiceSessionPlugin = plugin;
    return plugin;
  }

  if (registeredNativeVoiceSessionPlugin) {
    return registeredNativeVoiceSessionPlugin;
  }

  const platform = capacitor?.getPlatform?.() ?? "web";
  if (platform === "web" || typeof capacitor?.registerPlugin !== "function") {
    return null;
  }

  registeredNativeVoiceSessionPlugin = capacitor.registerPlugin("CrewCmdVoiceSession");
  return registeredNativeVoiceSessionPlugin;
}

export async function getNativeVoiceSessionAvailability(): Promise<NativeVoiceSessionAvailability> {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.isAvailable) {
    const detail = getNativeVoicePluginDebugDetail();
    publishAgentModeDiagnostic({
      scope: "native-voice-session",
      event: "plugin.unavailable",
      detail,
    });
    return { available: false, platform: detail.platform, backgroundCapable: false };
  }

  try {
    return await plugin.isAvailable();
  } catch (error) {
    publishAgentModeDiagnostic({
      scope: "native-voice-session",
      event: "availability.error",
      detail: { message: error instanceof Error ? error.message : String(error) },
    });
    return { available: false, platform: "unknown", backgroundCapable: false };
  }
}


function isLocalhostUrl(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function resolveNativeApiBaseUrl(explicitBaseUrl?: string) {
  const candidates = [
    explicitBaseUrl,
    process.env.NEXT_PUBLIC_CREWCMD_NATIVE_API_BASE_URL,
    typeof window !== "undefined" ? window.location.origin : "",
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  const nativeShell = isNativeCapacitorShell();
  let rejectedLocalhost: string | null = null;

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        continue;
      }
      if (nativeShell && isLocalhostUrl(url)) {
        rejectedLocalhost = url.origin;
        continue;
      }
      return url.origin;
    } catch {
      // Try the next source before reporting a base URL diagnostic.
    }
  }

  publishAgentModeDiagnostic({
    scope: "native-voice-session",
    event: "base-url.unsupported",
    detail: {
      candidates,
      nativeShell,
      rejectedLocalhost,
      windowOrigin: typeof window !== "undefined" ? window.location.origin : null,
    },
  });
  return "";
}

async function createNativeVoiceUploadToken() {
  const response = await fetch("/api/mobile/voice-session/token", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Unable to create native voice upload token: ${response.status}`);
  }
  return (await response.json()) as { token: string; expiresAt: number };
}

export async function startNativeVoiceSession(options: NativeVoiceSessionStartOptions = {}) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.start) return null;

  const voiceSessionId = options.voiceSessionId ?? createAgentModeSessionId("native-voice");
  const token = options.uploadToken ? null : await createNativeVoiceUploadToken();
  const status = await plugin.start({
    ...options,
    voiceSessionId,
    baseUrl: resolveNativeApiBaseUrl(options.baseUrl),
    uploadToken: options.uploadToken ?? token?.token,
  });
  publishAgentModeDiagnostic({
    scope: "native-voice-session",
    event: "start.complete",
    sessionId: voiceSessionId,
    detail: status,
  });
  return { voiceSessionId, status };
}

export async function getNativeVoiceSessionStatus() {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.status) return null;
  return plugin.status();
}

export async function stopNativeVoiceSession() {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.stop) return null;
  const status = await plugin.stop();
  publishAgentModeDiagnostic({
    scope: "native-voice-session",
    event: "stop.complete",
    detail: status,
  });
  return status;
}

export async function setNativeVoiceSessionMuted(muted: boolean) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.muteMic) return null;
  return plugin.muteMic({ muted });
}

export async function playNativeVoiceAudio(options: NativeVoiceAudioPlaybackOptions) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.playAudio) return null;
  return plugin.playAudio(options);
}

export async function speakNativeVoiceText(options: NativeVoiceSpeechOptions) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.speakText) return null;
  return plugin.speakText(options);
}

export async function stopNativeVoiceAudio() {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.stopAudio) return null;
  return plugin.stopAudio();
}

export async function addNativeVoiceSessionListener(
  eventName: "voiceLevel" | "voiceSessionDiagnostic" | "voiceTranscript",
  listener: (event: Record<string, unknown>) => void,
) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.addListener) return null;
  return plugin.addListener(eventName, listener);
}
