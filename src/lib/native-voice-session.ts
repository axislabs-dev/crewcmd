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
};

type NativePluginHandle = { remove: () => Promise<void> };

type NativeVoiceSessionPlugin = {
  isAvailable?: () => Promise<NativeVoiceSessionAvailability>;
  start?: (options: NativeVoiceSessionStartOptions) => Promise<NativeVoiceSessionStatus>;
  stop?: () => Promise<NativeVoiceSessionStatus>;
  muteMic?: (options: { muted: boolean }) => Promise<NativeVoiceSessionStatus>;
  status?: () => Promise<NativeVoiceSessionStatus>;
  addListener?: (eventName: string, listenerFunc: (event: Record<string, unknown>) => void) => Promise<NativePluginHandle>;
};

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string;
    Plugins?: {
      CrewCmdVoiceSession?: NativeVoiceSessionPlugin;
    };
  };
};

export function getNativeVoiceSessionPlugin(): NativeVoiceSessionPlugin | null {
  if (typeof window === "undefined") return null;
  return (window as CapacitorWindow).Capacitor?.Plugins?.CrewCmdVoiceSession ?? null;
}

export async function getNativeVoiceSessionAvailability(): Promise<NativeVoiceSessionAvailability> {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.isAvailable) {
    return { available: false, platform: "web", backgroundCapable: false };
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

export async function startNativeVoiceSession(options: NativeVoiceSessionStartOptions = {}) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.start) return null;

  const voiceSessionId = options.voiceSessionId ?? createAgentModeSessionId("native-voice");
  const status = await plugin.start({ ...options, voiceSessionId });
  publishAgentModeDiagnostic({
    scope: "native-voice-session",
    event: "start.complete",
    sessionId: voiceSessionId,
    detail: status,
  });
  return { voiceSessionId, status };
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

export async function addNativeVoiceSessionListener(
  eventName: "voiceLevel" | "voiceSessionDiagnostic",
  listener: (event: Record<string, unknown>) => void,
) {
  const plugin = getNativeVoiceSessionPlugin();
  if (!plugin?.addListener) return null;
  return plugin.addListener(eventName, listener);
}
