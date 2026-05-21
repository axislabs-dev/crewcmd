import {
  cancelRealtimeRelayOutput,
  openRealtimeRelayEvents,
  sendRealtimeRelayAudio,
  sendRealtimeRelayMark,
  sendRealtimeRelayToolResult,
  stopRealtimeRelay,
  type RealtimeVoiceSession,
} from "./realtime-voice-client";
import { base64ToBytes, bytesToBase64, floatToPcm16, pcm16ToFloat, rmsLevel } from "./realtime-voice-audio";

export type RealtimeVoiceStatus = "idle" | "listening" | "processing" | "speaking" | "error";

const BARGE_IN_RMS_THRESHOLD = 0.02;
const BARGE_IN_PEAK_THRESHOLD = 0.08;
const BARGE_IN_FRAMES = 2;

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
      const pcm = floatToPcm16(input);
      if (this.detectBargeInSpeech(input)) this.cancelOutputForBargeIn();
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
          this.callbacks.onTranscript?.({
            role: event.role,
            text: event.text,
            final: event.final ?? false,
          });
        }
        return;
      case "toolCall":
        this.submitUnavailableToolResult(event);
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
      if (this.sources.size === 0) this.callbacks.onSpeakingChange?.(false);
    });
    source.buffer = buffer;
    source.connect(this.outputContext.destination);
    const startAt = Math.max(this.outputContext.currentTime, this.playhead);
    source.start(startAt);
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

  private submitUnavailableToolResult(event: Extract<GatewayRelayEvent, { type?: "toolCall" }>): void {
    if (!this.session.relaySessionId || !event.callId) return;
    void sendRealtimeRelayToolResult(this.runtimeId, this.session.relaySessionId, event.callId, {
      error: "Realtime browser tool calls are not wired into CrewCMD yet.",
      name: event.name ?? null,
    }).catch(() => {});
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

  private detectBargeInSpeech(input: Float32Array): boolean {
    if (this.sources.size === 0 || this.cancelRequestedForPlayback || input.length === 0) {
      this.speechFramesDuringPlayback = 0;
      return false;
    }

    let peak = 0;
    let sum = 0;
    for (const sample of input) {
      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / input.length);
    if (rms >= BARGE_IN_RMS_THRESHOLD && peak >= BARGE_IN_PEAK_THRESHOLD) {
      this.speechFramesDuringPlayback += 1;
    } else {
      this.speechFramesDuringPlayback = 0;
    }

    return this.speechFramesDuringPlayback >= BARGE_IN_FRAMES;
  }
}
