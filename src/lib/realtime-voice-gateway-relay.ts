import {
  cancelRealtimeRelayOutput,
  openRealtimeRelayEvents,
  sendRealtimeRelayAudio,
  sendRealtimeRelayMark,
  sendRealtimeRelayToolCall,
  sendRealtimeRelayToolResult,
  stopRealtimeRelay,
  type RealtimeVoiceSession,
} from "./realtime-voice-client";
import { buildCurrentPageContextForRealtime, formatPageContextForPrompt } from "./page-context-store";
import { base64ToBytes, bytesToBase64, floatToPcm16, pcm16ToFloat, rmsLevel } from "./realtime-voice-audio";

export type RealtimeVoiceStatus = "idle" | "listening" | "processing" | "speaking" | "error";

const BARGE_IN_RMS_THRESHOLD = 0.02;
const BARGE_IN_PEAK_THRESHOLD = 0.08;
const BARGE_IN_FRAMES = 2;
const MOBILE_BARGE_IN_RMS_THRESHOLD = 0.055;
const MOBILE_BARGE_IN_PEAK_THRESHOLD = 0.16;
const MOBILE_BARGE_IN_FRAMES = 4;
const MOBILE_BARGE_IN_GRACE_MS = 750;

export interface RealtimeBargeInProfile {
  rmsThreshold: number;
  peakThreshold: number;
  frames: number;
  graceMs: number;
  suppressEchoInput: boolean;
}

export interface RealtimeBargeInDetectionInput {
  input: Float32Array;
  activeOutput: boolean;
  cancelRequested: boolean;
  speechFrames: number;
  outputStartedAtMs: number | null;
  nowMs: number;
  profile: RealtimeBargeInProfile;
}

export const DESKTOP_REALTIME_BARGE_IN_PROFILE: RealtimeBargeInProfile = {
  rmsThreshold: BARGE_IN_RMS_THRESHOLD,
  peakThreshold: BARGE_IN_PEAK_THRESHOLD,
  frames: BARGE_IN_FRAMES,
  graceMs: 0,
  suppressEchoInput: false,
};

export const MOBILE_REALTIME_BARGE_IN_PROFILE: RealtimeBargeInProfile = {
  rmsThreshold: MOBILE_BARGE_IN_RMS_THRESHOLD,
  peakThreshold: MOBILE_BARGE_IN_PEAK_THRESHOLD,
  frames: MOBILE_BARGE_IN_FRAMES,
  graceMs: MOBILE_BARGE_IN_GRACE_MS,
  suppressEchoInput: true,
};

export interface RealtimeGatewayRelayCallbacks {
  onStatus?: (status: RealtimeVoiceStatus, message?: string) => void;
  onTranscript?: (event: { role: "user" | "assistant"; text: string; final: boolean }) => void;
  onVoiceLevel?: (level: number) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
}

type GatewayRelayEvent =
  | { relaySessionId?: string; type?: "ready" }
  | { relaySessionId?: string; type?: "audio"; audioBase64?: string }
  | { relaySessionId?: string; type?: "clear" }
  | { relaySessionId?: string; type?: "mark"; markName?: string }
  | {
      relaySessionId?: string;
      type?: "transcript";
      role?: "user" | "assistant";
      text?: string;
      final?: boolean;
    }
  | {
      relaySessionId?: string;
      type?: "toolCall";
      callId?: string;
      name?: string;
      args?: unknown;
    }
  | { relaySessionId?: string; type?: "error"; message?: string }
  | { relaySessionId?: string; type?: "close"; reason?: string };

export class RealtimeGatewayRelaySession {
  private media: MediaStream | null = null;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private eventSource: EventSource | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;
  private closed = false;
  private cancelRequestedForPlayback = false;
  private speechFramesDuringPlayback = 0;
  private outputStartedAtMs: number | null = null;
  private pendingToolCalls = 0;
  private readonly bargeInProfile = resolveRealtimeBargeInProfile();

  constructor(
    private readonly runtimeId: string,
    private readonly session: RealtimeVoiceSession,
    private readonly callbacks: RealtimeGatewayRelayCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Realtime voice requires browser microphone access");
    }
    if (!this.session.relaySessionId) {
      throw new Error("Realtime gateway relay session is missing relaySessionId");
    }

    const inputSampleRate = this.session.audio?.inputSampleRateHz ?? 24000;
    const outputSampleRate = this.session.audio?.outputSampleRateHz ?? 24000;
    this.closed = false;
    this.eventSource = openRealtimeRelayEvents(this.runtimeId, this.session.relaySessionId);
    this.eventSource.addEventListener("realtime_relay", (event) => {
      this.handleRelayEvent(JSON.parse(event.data) as GatewayRelayEvent);
    });
    this.eventSource.onerror = () => {
      if (!this.closed) {
        this.callbacks.onStatus?.("error", "Realtime relay event stream failed");
      }
    };

    this.media = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.inputContext = new AudioContext({ sampleRate: inputSampleRate });
    this.outputContext = new AudioContext({ sampleRate: outputSampleRate });
    this.startMicrophonePump();
    this.callbacks.onStatus?.("listening");
  }

  stop(): void {
    this.closed = true;
    this.inputProcessor?.disconnect();
    this.inputProcessor = null;
    this.inputSource?.disconnect();
    this.inputSource = null;
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = null;
    this.eventSource?.close();
    this.eventSource = null;
    this.stopOutput();
    void this.inputContext?.close();
    this.inputContext = null;
    void this.outputContext?.close();
    this.outputContext = null;
    if (this.session.relaySessionId) {
      void stopRealtimeRelay(this.runtimeId, this.session.relaySessionId).catch(() => {});
    }
    this.callbacks.onSpeakingChange?.(false);
    this.callbacks.onStatus?.("idle");
  }

  setMicMuted(muted: boolean): void {
    this.media?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted) this.callbacks.onVoiceLevel?.(0);
  }

  stopOutput(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    this.playhead = this.outputContext?.currentTime ?? 0;
    this.speechFramesDuringPlayback = 0;
    this.outputStartedAtMs = null;
    this.callbacks.onSpeakingChange?.(false);
  }

  private startMicrophonePump(): void {
    if (!this.media || !this.inputContext || !this.session.relaySessionId) return;

    this.inputSource = this.inputContext.createMediaStreamSource(this.media);
    this.inputProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
    this.inputProcessor.onaudioprocess = (event) => {
      if (this.closed || !this.session.relaySessionId) return;
      const input = event.inputBuffer.getChannelData(0);
      this.callbacks.onVoiceLevel?.(rmsLevel(input));
      const bargeIn = this.detectBargeInSpeech(input);
      const pcm = bargeIn.suppressInput
        ? new Uint8Array(input.length * 2)
        : floatToPcm16(input);
      if (bargeIn.triggered) this.cancelOutputForBargeIn();
      void sendRealtimeRelayAudio(this.runtimeId, {
        relaySessionId: this.session.relaySessionId,
        audioBase64: bytesToBase64(pcm),
        timestamp: Math.round((this.inputContext?.currentTime ?? 0) * 1000),
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.callbacks.onError?.(message);
      });
    };
    this.inputSource.connect(this.inputProcessor);
    this.inputProcessor.connect(this.inputContext.destination);
  }

  private handleRelayEvent(event: GatewayRelayEvent): void {
    if (event.relaySessionId !== this.session.relaySessionId || this.closed) return;

    switch (event.type) {
      case "ready":
        this.callbacks.onStatus?.("listening");
        return;
      case "audio":
        if (event.audioBase64) {
          this.cancelRequestedForPlayback = false;
          this.playPcm16(event.audioBase64);
        }
        return;
      case "clear":
        this.stopOutput();
        return;
      case "mark":
        this.scheduleMarkAck(event.markName);
        return;
      case "transcript":
        if (event.role && event.text) {
          if (event.role === "assistant" && this.pendingToolCalls > 0) return;
          this.callbacks.onTranscript?.({
            role: event.role,
            text: event.text,
            final: event.final ?? false,
          });
        }
        return;
      case "toolCall":
        this.handleToolCall(event);
        return;
      case "error":
        this.callbacks.onStatus?.("error", event.message ?? "Realtime relay failed");
        return;
      case "close":
        this.callbacks.onStatus?.(event.reason === "error" ? "error" : "idle");
        return;
      default:
        return;
    }
  }

  private playPcm16(base64: string): void {
    if (!this.outputContext) return;
    const samples = pcm16ToFloat(base64ToBytes(base64));
    if (samples.length === 0) return;

    const sampleRate = this.session.audio?.outputSampleRateHz ?? this.outputContext.sampleRate;
    const buffer = this.outputContext.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.outputContext.createBufferSource();
    this.sources.add(source);
    source.addEventListener("ended", () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        this.outputStartedAtMs = null;
        this.callbacks.onSpeakingChange?.(false);
      }
    });
    source.buffer = buffer;
    source.connect(this.outputContext.destination);
    const startAt = Math.max(this.outputContext.currentTime, this.playhead);
    source.start(startAt);
    this.outputStartedAtMs ??= performanceNow();
    this.playhead = startAt + buffer.duration;
    this.callbacks.onSpeakingChange?.(true);
    this.callbacks.onStatus?.("speaking");
  }

  private scheduleMarkAck(markName?: string): void {
    const delayMs = Math.max(
      0,
      Math.ceil(((this.playhead || this.outputContext?.currentTime || 0) - (this.outputContext?.currentTime ?? 0)) * 1000),
    );
    window.setTimeout(() => {
      if (!this.closed && this.session.relaySessionId) {
        void sendRealtimeRelayMark(this.runtimeId, this.session.relaySessionId, markName).catch(() => {});
      }
    }, delayMs);
  }

  private handleToolCall(event: Extract<GatewayRelayEvent, { type?: "toolCall" }>): void {
    const relaySessionId = this.session.relaySessionId;
    const sessionKey = typeof this.session.sessionKey === "string" && this.session.sessionKey.trim()
      ? this.session.sessionKey.trim()
      : "main";
    if (!relaySessionId || !event.callId || !event.name) return;
    const callId = event.callId;
    const name = event.name;

    this.callbacks.onStatus?.("processing", "Consulting OpenClaw");
    this.pendingToolCalls += 1;
    void (async () => {
      try {
        const result = await sendRealtimeRelayToolCall(this.runtimeId, {
          relaySessionId,
          sessionKey,
          callId,
          name,
          args: withRealtimeScreenContext(event.args ?? {}),
        });
        if (result.finalText?.trim()) {
          this.callbacks.onTranscript?.({
            role: "assistant",
            text: result.finalText.trim(),
            final: true,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.callbacks.onError?.(message);
        void sendRealtimeRelayToolResult(this.runtimeId, relaySessionId, callId, {
          error: message,
          name,
        }).catch(() => {});
      } finally {
        this.pendingToolCalls = Math.max(0, this.pendingToolCalls - 1);
      }
    })();
  }

  private cancelOutputForBargeIn(): void {
    if (!this.session.relaySessionId || this.cancelRequestedForPlayback) return;
    this.cancelRequestedForPlayback = true;
    this.stopOutput();
    this.callbacks.onStatus?.("listening", "Interrupted");
    void cancelRealtimeRelayOutput(this.runtimeId, this.session.relaySessionId, "barge-in").catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.(message);
    });
  }

  private detectBargeInSpeech(input: Float32Array) {
    const result = detectRealtimeBargeIn({
      input,
      activeOutput: this.sources.size > 0,
      cancelRequested: this.cancelRequestedForPlayback,
      speechFrames: this.speechFramesDuringPlayback,
      outputStartedAtMs: this.outputStartedAtMs,
      nowMs: performanceNow(),
      profile: this.bargeInProfile,
    });
    this.speechFramesDuringPlayback = result.speechFrames;
    return result;
  }
}

export function withRealtimeScreenContext(args: unknown) {
  const screenContext = formatPageContextForPrompt(buildCurrentPageContextForRealtime());
  if (!screenContext) return args;

  const normalized = normalizeRealtimeToolArgs(args);
  const existingContext = typeof normalized.context === "string" && normalized.context.trim()
    ? normalized.context.trim()
    : null;
  return {
    ...normalized,
    context: [existingContext, screenContext].filter(Boolean).join("\n\n"),
  };
}

function normalizeRealtimeToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) return { ...args as Record<string, unknown> };
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...parsed as Record<string, unknown> };
      }
    } catch {
      return { question: args };
    }
    return { question: args };
  }
  return {};
}

export function resolveRealtimeBargeInProfile(userAgent = readUserAgent(), hasCapacitor = readHasCapacitor()) {
  return hasCapacitor || /android|iphone|ipad|ipod|mobile/i.test(userAgent)
    ? MOBILE_REALTIME_BARGE_IN_PROFILE
    : DESKTOP_REALTIME_BARGE_IN_PROFILE;
}

export function detectRealtimeBargeIn(input: RealtimeBargeInDetectionInput) {
  if (
    !input.activeOutput ||
    input.cancelRequested ||
    input.input.length === 0 ||
    isWithinGraceWindow(input)
  ) {
    return {
      triggered: false,
      speechFrames: 0,
      suppressInput: input.profile.suppressEchoInput && input.activeOutput && !input.cancelRequested,
    };
  }

  let peak = 0;
  let sum = 0;
  for (const sample of input.input) {
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / input.input.length);
  const speechFrames = rms >= input.profile.rmsThreshold && peak >= input.profile.peakThreshold
    ? input.speechFrames + 1
    : 0;

  return {
    triggered: speechFrames >= input.profile.frames,
    speechFrames,
    suppressInput: input.profile.suppressEchoInput && input.activeOutput && speechFrames < input.profile.frames,
  };
}

function isWithinGraceWindow(input: RealtimeBargeInDetectionInput) {
  return Boolean(
    input.outputStartedAtMs !== null &&
    input.profile.graceMs > 0 &&
    input.nowMs - input.outputStartedAtMs < input.profile.graceMs,
  );
}

function readUserAgent() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

function readHasCapacitor() {
  return typeof window !== "undefined" && Boolean((window as { Capacitor?: unknown }).Capacitor);
}

function performanceNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
