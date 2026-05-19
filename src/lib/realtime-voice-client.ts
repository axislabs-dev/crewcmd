export type RealtimeVoiceTransport = "webrtc-sdp" | "json-pcm-websocket" | "gateway-relay";

export interface RealtimeVoiceSessionRequest {
  runtimeId: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  voice?: string;
  agentId?: string;
}

export interface RealtimeVoiceSession {
  sessionId?: string;
  relaySessionId?: string;
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
    }),
  });

  if (!response.ok) {
    throw new Error(await readRealtimeVoiceError(response, "Failed to start realtime voice session"));
  }

  const data = await response.json();
  return data.session as RealtimeVoiceSession;
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
}

async function readRealtimeVoiceError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" && data.error.trim().length > 0 ? data.error : fallback;
}
