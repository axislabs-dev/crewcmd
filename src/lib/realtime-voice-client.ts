import {
  GOOGLE_REALTIME_VOICE_IDS,
  OPENAI_REALTIME_VOICE_IDS,
  normalizeAgentVoiceSettings,
  type AgentVoiceSettings,
} from "@/lib/tts-voices";
import {
  microphoneDeniedRealtimeVoiceReadiness,
  unreachableRealtimeVoiceReadiness,
  type RealtimeVoiceReadiness,
} from "@/lib/realtime-voice-readiness";

export type RealtimeVoiceTransport = "webrtc-sdp" | "json-pcm-websocket" | "gateway-relay";

export interface RealtimeVoiceSessionRequest {
  runtimeId: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  voice?: string;
  agentId?: string;
  channelId?: string | null;
  channelAgentId?: string | null;
}

export interface RealtimeVoiceReadinessRequest {
  runtimeId: string;
  provider?: string;
}

export interface RealtimeVoiceSession {
  sessionId?: string;
  relaySessionId?: string;
  sessionKey?: string;
  transport?: RealtimeVoiceTransport | string;
  provider?: string;
  model?: string;
  voice?: string;
  expiresAt?: string;
  offerUrl?: string;
  websocketUrl?: string;
  clientSecret?: string;
  headers?: Record<string, string>;
  config?: Record<string, unknown>;
  audio?: {
    inputEncoding?: string;
    outputEncoding?: string;
    inputSampleRateHz?: number;
    outputSampleRateHz?: number;
  };
  [key: string]: unknown;
}

export interface RealtimeRelayAudioChunk {
  relaySessionId: string;
  audioBase64: string;
  timestamp?: number;
}

export interface RealtimeRelayToolCall {
  relaySessionId: string;
  sessionKey: string;
  callId: string;
  name: string;
  args?: unknown;
}

export interface RealtimeRelayToolCallResult {
  delegated?: boolean;
  runId?: string;
  finalText?: string;
  result?: unknown;
}

export async function startRealtimeVoiceSession(
  request: RealtimeVoiceSessionRequest,
): Promise<RealtimeVoiceSession> {
  const response = await fetch(`/api/runtimes/${encodeURIComponent(request.runtimeId)}/talk/realtime/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: request.sessionKey,
      provider: request.provider,
      model: request.model,
      voice: request.voice,
      agentId: request.agentId,
      channelId: request.channelId,
      channelAgentId: request.channelAgentId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readRealtimeVoiceError(response, "Failed to start realtime voice session"));
  }

  const data = await response.json();
  const session = data.session as RealtimeVoiceSession;
  return {
    ...session,
    sessionKey: session.sessionKey ?? request.sessionKey ?? "main",
  };
}

export async function getRealtimeVoiceReadiness(
  request: RealtimeVoiceReadinessRequest,
): Promise<RealtimeVoiceReadiness> {
  const params = new URLSearchParams();
  if (request.provider) params.set("provider", request.provider);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  try {
    const response = await fetch(
      `/api/runtimes/${encodeURIComponent(request.runtimeId)}/talk/realtime/session${query}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      return unreachableRealtimeVoiceReadiness(
        await readRealtimeVoiceError(response, "Readiness check failed"),
      );
    }

    const data = await response.json().catch(() => null);
    const readiness = data?.readiness as RealtimeVoiceReadiness | undefined;
    if (!readiness || typeof readiness.status !== "string") {
      return unreachableRealtimeVoiceReadiness("OpenClaw readiness response was invalid");
    }

    if (readiness.status === "ready" && await isMicrophonePermissionDenied()) {
      return microphoneDeniedRealtimeVoiceReadiness(readiness);
    }
    return readiness;
  } catch {
    return unreachableRealtimeVoiceReadiness("Readiness check failed");
  }
}

export function resolveRealtimeVoiceSessionSettings(
  voiceSettings?: AgentVoiceSettings | null,
): Pick<RealtimeVoiceSessionRequest, "provider" | "model" | "voice"> {
  const voice = normalizeAgentVoiceSettings(voiceSettings);
  if (voice.enabled === false) return {};

  const rawVoiceId = voice.voiceId?.trim();
  const voiceId = rawVoiceId?.toLowerCase();
  const model = voice.model?.trim();
  if (voice.provider === "google") {
    return {
      provider: "google",
      voice: voiceId && GOOGLE_REALTIME_VOICE_IDS.has(voiceId) ? rawVoiceId : undefined,
      model: model?.includes("native-audio") || model?.includes("live") ? model : undefined,
    };
  }
  if (voice.provider !== "openai") return {};

  return {
    provider: "openai",
    voice: voiceId && OPENAI_REALTIME_VOICE_IDS.has(voiceId) ? voiceId : undefined,
    model: model?.includes("realtime") ? model : undefined,
  };
}

export async function sendRealtimeRelayAudio(runtimeId: string, chunk: RealtimeRelayAudioChunk): Promise<void> {
  await postRealtimeRelay(runtimeId, {
    action: "audio",
    ...chunk,
  });
}

export async function sendRealtimeRelayMark(runtimeId: string, relaySessionId: string, markName?: string): Promise<void> {
  await postRealtimeRelay(runtimeId, {
    action: "mark",
    relaySessionId,
    markName,
  });
}

export async function cancelRealtimeRelayOutput(
  runtimeId: string,
  relaySessionId: string,
  reason = "barge-in",
): Promise<void> {
  await postRealtimeRelay(runtimeId, {
    action: "cancelOutput",
    relaySessionId,
    reason,
  });
}

export async function sendRealtimeRelayToolResult(
  runtimeId: string,
  relaySessionId: string,
  callId: string,
  output: unknown,
): Promise<void> {
  await postRealtimeRelay(runtimeId, {
    action: "toolResult",
    relaySessionId,
    callId,
    result: output,
  });
}

export async function sendRealtimeRelayToolCall(
  runtimeId: string,
  toolCall: RealtimeRelayToolCall,
): Promise<RealtimeRelayToolCallResult> {
  const data = await postRealtimeRelay(runtimeId, {
    action: "toolCall",
    ...toolCall,
  });
  return data.result && typeof data.result === "object"
    ? data.result as RealtimeRelayToolCallResult
    : {};
}

export async function stopRealtimeRelay(runtimeId: string, relaySessionId: string): Promise<void> {
  await postRealtimeRelay(runtimeId, {
    action: "stop",
    relaySessionId,
  });
}

export function openRealtimeRelayEvents(runtimeId: string, relaySessionId: string): EventSource {
  const params = new URLSearchParams({ relaySessionId });
  return new EventSource(
    `/api/runtimes/${encodeURIComponent(runtimeId)}/talk/realtime/events?${params.toString()}`,
  );
}

async function postRealtimeRelay(runtimeId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/talk/realtime/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readRealtimeVoiceError(response, "Realtime relay request failed"));
  }
  return await response.json().catch(() => ({})) as { result?: unknown };
}

async function readRealtimeVoiceError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" && data.error.trim().length > 0 ? data.error : fallback;
}

async function isMicrophonePermissionDenied() {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return false;
  try {
    const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return permission.state === "denied";
  } catch {
    return false;
  }
}
