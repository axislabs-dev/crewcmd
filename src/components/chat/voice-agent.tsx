"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useOrientationLock } from "@/hooks/use-orientation-lock";
import { AgentVisualizer } from "@/components/chat/agent-visualizer";
import {
  buildMediaRecorderOptions,
  createBrowserAudioContext,
  getAudioBlobType,
  getAudioFilenameForMime,
  selectAudioRecorderFormat,
} from "@/lib/audio-capture";
import {
  createAgentModeSessionId,
  publishAgentModeDiagnostic,
  recordVoiceCrashBreadcrumb,
} from "@/lib/agent-mode-diagnostics";
import {
  addNativeVoiceSessionListener,
  getNativeVoiceSessionAvailability,
  getNativeVoiceSessionStatus,
  setNativeVoiceSessionMuted,
  startNativeVoiceSession,
  stopNativeVoiceSession,
} from "@/lib/native-voice-session";
import {
  getRealtimeVoiceReadiness,
  resolveRealtimeVoiceSessionIdentity,
  resolveRealtimeVoiceSessionSettings,
  startRealtimeVoiceSession,
  type RealtimeVoiceSession,
} from "@/lib/realtime-voice-client";
import {
  deriveRealtimeVoiceReadiness,
  type RealtimeVoiceReadiness,
} from "@/lib/realtime-voice-readiness";
import { RealtimeGatewayRelaySession, type RealtimeVoiceStatus } from "@/lib/realtime-voice-gateway-relay";
import type { AgentVoiceSettings } from "@/lib/tts-voices";
import type { AgentVisualSettings } from "@/lib/agent-visual-settings";

type AgentState = "listening" | "processing" | "speaking" | "muted" | "idle";

export interface VoiceAgentRealtimeTranscript {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface VoiceAgentProps {
  onTranscript: (text: string) => void;
  onRealtimeTranscript?: (event: VoiceAgentRealtimeTranscript) => void;
  isPlayingAudio: boolean;
  onInterrupt: () => void;
  isLoading: boolean;
  accentColor?: string;
  autoActivate?: boolean;
  immersive?: boolean;
  compact?: boolean;
  isMicMuted?: boolean;
  isAgentMuted?: boolean;
  onMicMutedChange?: (muted: boolean) => void;
  onAgentMutedChange?: (muted: boolean) => void;
  onVoiceLevel?: (level: number) => void;
  agent?: string;
  gatewayAgent?: string;
  companyId?: string;
  channelId?: string | null;
  sessionKey?: string;
  realtimeRuntimeId?: string;
  voiceSettings?: AgentVoiceSettings | null;
  visualSettings?: AgentVisualSettings | null;
}

function hexToRgb(hex: string): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "99,183,170";
  const value = parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r}, ${g}, ${b}`;
}

// VAD configuration
const SILENCE_THRESHOLD = 0.015; // RMS threshold for "silence"
const BARGEIN_THRESHOLD = 0.06; // Higher threshold during TTS playback (ignore fridge, etc.)
const SPEECH_START_MS = 200; // ms of sound to trigger recording
const BARGEIN_START_MS = 600; // ms of sustained loud sound to interrupt TTS
const SILENCE_END_MS = 2000; // ms of silence to stop recording (2s for natural pauses)
const MIN_RECORDING_MS = 500; // minimum recording length to send

function isNativeCapacitorShell() {
  if (typeof window === "undefined") return false;
  const capacitor = (window as Window & {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
    };
  }).Capacitor;
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android";
}

async function isServerSttAvailable() {
  try {
    const response = await fetch("/api/stt", { signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => null);
    return response.ok && data?.available === true;
  } catch {
    return false;
  }
}

export function VoiceAgent(props: VoiceAgentProps) {
  const realtimeSessionIdentity = resolveRealtimeVoiceSessionIdentity(props.voiceSettings);
  return <VoiceAgentSession key={realtimeSessionIdentity} {...props} />;
}

function VoiceAgentSession({
  onTranscript,
  onRealtimeTranscript,
  isPlayingAudio,
  onInterrupt,
  isLoading,
  accentColor = "#63b7aa",
  autoActivate = false,
  immersive = false,
  compact = false,
  isMicMuted = false,
  isAgentMuted = false,
  onMicMutedChange,
  onAgentMutedChange,
  onVoiceLevel,
  agent,
  gatewayAgent,
  companyId,
  channelId,
  sessionKey,
  realtimeRuntimeId,
  voiceSettings,
  visualSettings,
}: VoiceAgentProps) {
  const realtimeEnabled = process.env.NEXT_PUBLIC_CREWCMD_REALTIME_VOICE === "1";
  const realtimeVoiceProvider = resolveRealtimeVoiceSessionSettings(voiceSettings).provider;
  const [state, setState] = useState<AgentState>("idle");
  const [isActive, setIsActive] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nativeBackgroundCapable, setNativeBackgroundCapable] = useState(false);
  const [nativeSessionActive, setNativeSessionActive] = useState(false);
  const [realtimeSession, setRealtimeSession] = useState<RealtimeVoiceSession | null>(null);
  const [realtimeReadiness, setRealtimeReadiness] = useState<RealtimeVoiceReadiness | null>(
    () => (realtimeEnabled ? null : deriveRealtimeVoiceReadiness({ enabled: false })),
  );

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const hasAutoActivatedRef = useRef(false);
  const diagnosticSessionRef = useRef<string | null>(null);
  const vadStartedAtRef = useRef<number>(0);
  const vadFrameCountRef = useRef(0);
  const lastVolumeLevelRef = useRef(0);
  const lastVolumeLevelAtRef = useRef(0);

  // VAD timing refs
  const speechStartTimeRef = useRef<number>(0);
  const silenceStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);
  const discardRecordingRef = useRef(false);
  const nativeVoiceSessionIdRef = useRef<string | null>(null);
  const nativeSessionActiveRef = useRef(false);
  const realtimeRelayRef = useRef<RealtimeGatewayRelaySession | null>(null);
  const deactivateRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!realtimeEnabled) {
      setRealtimeReadiness(deriveRealtimeVoiceReadiness({ enabled: false }));
      return;
    }
    if (!realtimeRuntimeId) {
      setRealtimeReadiness(null);
      return;
    }

    let cancelled = false;
    void getRealtimeVoiceReadiness({
      runtimeId: realtimeRuntimeId,
      provider: realtimeVoiceProvider,
    }).then((readiness) => {
      if (!cancelled) setRealtimeReadiness(readiness);
    });
    return () => {
      cancelled = true;
    };
  }, [realtimeEnabled, realtimeRuntimeId, realtimeVoiceProvider]);

  useEffect(() => {
    onVoiceLevel?.(volumeLevel);
  }, [onVoiceLevel, volumeLevel]);

  const updateVolumeLevel = useCallback((nextLevel: number) => {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(nextLevel) ? nextLevel : 0));
    const now = Date.now();
    if (
      now - lastVolumeLevelAtRef.current < 24 &&
      Math.abs(normalized - lastVolumeLevelRef.current) < 0.012
    ) {
      return;
    }
    lastVolumeLevelAtRef.current = now;
    lastVolumeLevelRef.current = normalized;
    setVolumeLevel(normalized);
  }, []);

  const recordVoiceBreadcrumb = useCallback((
    event: string,
    detail?: Record<string, unknown>,
  ) => {
    recordVoiceCrashBreadcrumb({
      scope: "voice-agent",
      event,
      sessionId: nativeVoiceSessionIdRef.current ?? diagnosticSessionRef.current ?? undefined,
      detail: {
        state,
        isActive,
        nativeSessionActive: nativeSessionActiveRef.current,
        realtimeTransport: realtimeSession?.transport ?? null,
        agent: agent ?? null,
        gatewayAgent: gatewayAgent ?? null,
        channelId: channelId ?? null,
        sessionKey: sessionKey ?? null,
        isPlayingAudio,
        isMicMuted,
        isAgentMuted,
        ...detail,
      },
    });
  }, [agent, channelId, gatewayAgent, isActive, isAgentMuted, isMicMuted, isPlayingAudio, realtimeSession?.transport, sessionKey, state]);

  const transcribe = useCallback(
    async (audioBlob: Blob) => {
      recordVoiceBreadcrumb("stt.fetch.start", { bytes: audioBlob.size, type: audioBlob.type });
      setState("processing");
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "stt.fetch.start",
        sessionId: diagnosticSessionRef.current ?? undefined,
        detail: { bytes: audioBlob.size, type: audioBlob.type },
      });
      try {
        const formData = new FormData();
        const uploadFormat = selectAudioRecorderFormat();
        const uploadMimeType = audioBlob.type || uploadFormat.mimeType || "audio/webm";
        formData.append("audio", audioBlob, getAudioFilenameForMime(uploadMimeType, uploadFormat));
        formData.append("mimeType", uploadMimeType);

        const response = await fetch("/api/stt", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          recordVoiceBreadcrumb("stt.fetch.error", { status: response.status });
          publishAgentModeDiagnostic({
            scope: "voice-agent",
            event: "stt.fetch.error",
            sessionId: diagnosticSessionRef.current ?? undefined,
            detail: { status: response.status },
          });
          setError(response.status === 503
            ? "Speech server unavailable. Deactivate and retry."
            : "Transcription failed. Try speaking again.");
          setState("listening");
          return;
        }

        const { text } = await response.json();
        recordVoiceBreadcrumb("stt.fetch.complete", { hasText: Boolean(text && text.trim()) });
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "stt.fetch.complete",
          sessionId: diagnosticSessionRef.current ?? undefined,
          detail: { hasText: Boolean(text && text.trim()) },
        });
        if (text && text.trim()) {
          setError(null);
          onTranscript(text.trim());
        } else {
          setState("listening");
        }
      } catch (error) {
        recordVoiceBreadcrumb("stt.fetch.exception", { message: error instanceof Error ? error.message : String(error) });
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "stt.fetch.exception",
          sessionId: diagnosticSessionRef.current ?? undefined,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
        setError("Speech server unreachable. Check your connection.");
        setState("listening");
      }
    },
    [onTranscript, recordVoiceBreadcrumb]
  );

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "media-recorder.stop",
        sessionId: diagnosticSessionRef.current ?? undefined,
      });
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    if (isRecordingRef.current || !streamRef.current) return;
    isRecordingRef.current = true;
    recordingStartTimeRef.current = Date.now();
    chunksRef.current = [];

    const recorderFormat = selectAudioRecorderFormat();
    const recorder = new MediaRecorder(streamRef.current, buildMediaRecorderOptions(recorderFormat));

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      if (discardRecordingRef.current) {
        discardRecordingRef.current = false;
        chunksRef.current = [];
        setState(isMicMuted ? "muted" : "listening");
        return;
      }
      const duration = Date.now() - recordingStartTimeRef.current;
      if (duration >= MIN_RECORDING_MS && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, {
          type: getAudioBlobType(mediaRecorderRef.current?.mimeType, recorderFormat),
        });
        transcribe(blob);
      } else {
        setState("listening");
      }
    };

    mediaRecorderRef.current = recorder;
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "media-recorder.start",
      sessionId: diagnosticSessionRef.current ?? undefined,
      detail: { mimeType: recorder.mimeType, extension: recorderFormat.extension },
    });
    recorder.start(100); // collect in 100ms chunks
  }, [isMicMuted, transcribe]);

  // VAD loop using AnalyserNode
  const runVAD = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Float32Array(analyser.fftSize);
    vadStartedAtRef.current = Date.now();
    vadFrameCountRef.current = 0;
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "vad.raf.start",
      sessionId: diagnosticSessionRef.current ?? undefined,
      detail: { fftSize: analyser.fftSize },
    });

    const tick = () => {
      if (!analyserRef.current) return;
      vadFrameCountRef.current++;
      if (vadFrameCountRef.current % 1800 === 0) {
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "vad.raf.heartbeat",
          sessionId: diagnosticSessionRef.current ?? undefined,
          detail: {
            frames: vadFrameCountRef.current,
            activeMs: Date.now() - vadStartedAtRef.current,
            mediaRecorderState: mediaRecorderRef.current?.state ?? null,
            audioContextState: audioContextRef.current?.state ?? null,
          },
        });
      }
      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (isMicMuted) {
        updateVolumeLevel(0);
        speechStartTimeRef.current = 0;
        silenceStartTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // When TTS is playing, show a synthetic pulse on the VU meter
      // (mic RMS is near-zero during playback so bars would be dead)
      if (isPlayingAudio) {
        const t = Date.now() / 1000;
        const pulse = 0.3 + 0.25 * Math.sin(t * 2.5) + 0.15 * Math.sin(t * 4.1) + 0.1 * Math.sin(t * 7.3);
        updateVolumeLevel(pulse);
      } else {
        updateVolumeLevel(rms * 10); // normalize for UI
      }

      const now = Date.now();
      // Use higher threshold during TTS to prevent ambient noise (fridge, etc.) from barging in
      const activeThreshold = isPlayingAudio ? BARGEIN_THRESHOLD : SILENCE_THRESHOLD;
      const activeStartMs = isPlayingAudio ? BARGEIN_START_MS : SPEECH_START_MS;
      const isSpeech = rms > activeThreshold;

      if (isSpeech) {
        silenceStartTimeRef.current = 0;

        if (!isRecordingRef.current) {
          // Detecting potential speech start
          if (speechStartTimeRef.current === 0) {
            speechStartTimeRef.current = now;
          } else if (now - speechStartTimeRef.current >= activeStartMs) {
            // Barge-in: if Neo is speaking, interrupt
            if (isPlayingAudio) {
              onInterrupt();
            }
            startRecording();
            setState("listening"); // actively listening/recording
          }
        }
      } else {
        speechStartTimeRef.current = 0;

        if (isRecordingRef.current) {
          if (silenceStartTimeRef.current === 0) {
            silenceStartTimeRef.current = now;
          } else if (now - silenceStartTimeRef.current >= SILENCE_END_MS) {
            stopRecording();
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [isMicMuted, isPlayingAudio, onInterrupt, startRecording, stopRecording, updateVolumeLevel]);

  // Screen Wake Lock — keeps screen on during agent mode (mobile)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "wake-lock.acquire",
          sessionId: diagnosticSessionRef.current ?? undefined,
        });
        wakeLockRef.current.addEventListener("release", () => {
          publishAgentModeDiagnostic({
            scope: "voice-agent",
            event: "wake-lock.release-event",
            sessionId: diagnosticSessionRef.current ?? undefined,
          });
          wakeLockRef.current = null;
        });
      }
    } catch (error) {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "wake-lock.error",
        sessionId: diagnosticSessionRef.current ?? undefined,
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
      // Wake lock can fail if battery is low or OS denies it — non-critical
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "wake-lock.release",
        sessionId: diagnosticSessionRef.current ?? undefined,
      });
    }
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  const startRealtimeRelay = useCallback(async (sessionId: string) => {
    if (!realtimeEnabled || !realtimeRuntimeId) return false;

    try {
      const realtimeVoiceSettings = resolveRealtimeVoiceSessionSettings(voiceSettings);
      const readiness = await getRealtimeVoiceReadiness({
        runtimeId: realtimeRuntimeId,
        provider: realtimeVoiceSettings.provider,
      });
      setRealtimeReadiness(readiness);
      if (readiness.status !== "ready") return false;

      const session = await startRealtimeVoiceSession({
        runtimeId: realtimeRuntimeId,
        sessionKey,
        agentId: gatewayAgent ?? agent,
        channelId,
        channelAgentId: agent,
        ...realtimeVoiceSettings,
      });
      setRealtimeSession(session);
      recordVoiceBreadcrumb("realtime.session.start", {
        transport: session.transport,
        provider: session.provider,
        model: session.model,
        requestedProvider: realtimeVoiceSettings.provider,
        requestedVoice: realtimeVoiceSettings.voice,
        requestedModel: realtimeVoiceSettings.model,
        hasRelaySessionId: Boolean(session.relaySessionId),
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "realtime.session.start",
        sessionId,
        detail: {
          transport: session.transport,
          provider: session.provider,
          model: session.model,
          requestedProvider: realtimeVoiceSettings.provider,
          requestedVoice: realtimeVoiceSettings.voice,
          requestedModel: realtimeVoiceSettings.model,
          hasRelaySessionId: Boolean(session.relaySessionId),
        },
      });

      if (session.transport !== "gateway-relay") {
        setError(`Realtime transport ${session.transport ?? "unknown"} is not wired into CrewCMD visuals yet. Falling back to recorded voice.`);
        return false;
      }

      const relay = new RealtimeGatewayRelaySession(realtimeRuntimeId, session, {
        onStatus: (status: RealtimeVoiceStatus, message?: string) => {
          if (status === "error") {
            setError(message ?? "Realtime voice failed.");
            setState("idle");
            return;
          }
          setError(null);
          setState(status === "processing" ? "processing" : status === "speaking" ? "speaking" : status === "listening" ? "listening" : "idle");
        },
        onTranscript: (event) => {
          recordVoiceBreadcrumb("realtime.transcript", {
            role: event.role,
            final: event.final,
            characters: event.text.length,
          });
          onRealtimeTranscript?.(event);
        },
        onVoiceLevel: setVolumeLevel,
        onSpeakingChange: (speaking) => {
          setState((current) => {
            if (speaking) return "speaking";
            return current === "speaking" ? "listening" : current;
          });
        },
        onError: (message) => {
          recordVoiceBreadcrumb("realtime.relay.error", { message });
        },
      });
      realtimeRelayRef.current = relay;
      await relay.start();
      await requestWakeLock();
      setIsActive(true);
      setState("listening");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRealtimeSession(null);
      realtimeRelayRef.current = null;
      recordVoiceBreadcrumb("realtime.session.error", { message });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "realtime.session.error",
        sessionId,
        detail: { message },
      });
      return false;
    }
  }, [agent, channelId, gatewayAgent, onRealtimeTranscript, realtimeEnabled, realtimeRuntimeId, recordVoiceBreadcrumb, requestWakeLock, sessionKey, voiceSettings]);

  const activate = useCallback(async () => {
    onMicMutedChange?.(false);
    onAgentMutedChange?.(false);
    setError(null);
    const sessionId = createAgentModeSessionId("voice-agent");
    diagnosticSessionRef.current = sessionId;
    recordVoiceBreadcrumb("activate.start", { sessionId });
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "activate.start",
      sessionId,
      detail: {
        isMicMuted,
        isAgentMuted,
        isPlayingAudio,
      },
    });

    const nativeAvailability = await getNativeVoiceSessionAvailability();
    setNativeBackgroundCapable(nativeAvailability.backgroundCapable);
    recordVoiceBreadcrumb("native-voice.availability", nativeAvailability);
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "native-voice.availability",
      sessionId,
      detail: nativeAvailability,
    });

    if (await startRealtimeRelay(sessionId)) {
      recordVoiceBreadcrumb("activate.realtime-relay", {
        nativeAvailable: nativeAvailability.available,
        nativeBackgroundCapable: nativeAvailability.backgroundCapable,
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.realtime-relay",
        sessionId,
        detail: {
          nativeAvailable: nativeAvailability.available,
          nativeBackgroundCapable: nativeAvailability.backgroundCapable,
        },
      });
      return;
    }

    if (nativeAvailability.available) {
      try {
        const nativeSession = await startNativeVoiceSession({
          voiceSessionId: sessionId,
          muted: false,
          agent,
          gatewayAgent,
          companyId,
          sessionKey,
        });
        nativeVoiceSessionIdRef.current = nativeSession?.voiceSessionId ?? sessionId;
        nativeSessionActiveRef.current = Boolean(nativeSession?.status.active);
        setNativeSessionActive(nativeSessionActiveRef.current);
        recordVoiceBreadcrumb("native-voice.start.complete", nativeSession?.status ?? {});
      } catch (error) {
        recordVoiceBreadcrumb("native-voice.start.error", { message: error instanceof Error ? error.message : String(error) });
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "native-voice.start.error",
          sessionId,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    if (nativeSessionActiveRef.current) {
      await requestWakeLock();
      setIsActive(true);
      setState("listening");
      recordVoiceBreadcrumb("activate.native-only", {
        reason: "skip-web-audio-for-native-session",
        nativeBackgroundCapable: nativeAvailability.backgroundCapable,
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.native-only",
        sessionId,
        detail: {
          reason: "skip-web-audio-for-native-session",
          nativeBackgroundCapable: nativeAvailability.backgroundCapable,
        },
      });
      return;
    }

    if (isNativeCapacitorShell()) {
      const message = nativeAvailability.available
        ? "Native voice session did not become active."
        : "Native voice plugin is unavailable in this build.";
      setError(message);
      setIsActive(false);
      setState("idle");
      recordVoiceBreadcrumb("activate.native-unavailable", {
        reason: "refuse-web-audio-fallback-in-native-shell",
        nativeAvailability,
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.native-unavailable",
        sessionId,
        detail: {
          reason: "refuse-web-audio-fallback-in-native-shell",
          nativeAvailability,
        },
      });
      return;
    }

    const serverSttAvailable = await isServerSttAvailable();
    recordVoiceBreadcrumb("stt.availability", { available: serverSttAvailable });
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "stt.availability",
      sessionId,
      detail: { available: serverSttAvailable },
    });
    if (!serverSttAvailable) {
      setError("Speech server unavailable. Configure OpenAI or local Whisper before using agent voice mode.");
      setIsActive(false);
      setState("idle");
      return;
    }

    // mediaDevices requires a secure context (HTTPS or localhost). On native iOS,
    // the CrewCmdVoiceSession plugin can still prove native background capture even
    // when WebView recording is unavailable, but transcription remains web-backed
    // until the native chunk upload phase lands.
    if (!navigator.mediaDevices) {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.unsupported",
        sessionId,
        detail: { nativeBackgroundCapable: nativeAvailability.backgroundCapable },
      });
      if (nativeAvailability.available) {
        await requestWakeLock();
        setIsActive(true);
        setState("listening");
        recordVoiceBreadcrumb("activate.native-only");
        setError("Native mic session active; web transcription is unavailable in this context.");
      } else {
        setError("Voice requires HTTPS. Access via localhost or run: pnpm dev:https");
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "media-stream.acquire",
        sessionId,
        detail: { tracks: stream.getTracks().map((track) => `${track.kind}:${track.readyState}`) },
      });

      const audioContext = createBrowserAudioContext();
      audioContextRef.current = audioContext;
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "audio-context.create",
        sessionId,
        detail: { state: audioContext.state, sampleRate: audioContext.sampleRate },
      });

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Keep screen awake on mobile
      await requestWakeLock();

      setIsActive(true);
      setState("listening");
      recordVoiceBreadcrumb("activate.complete", {
        audioContextState: audioContext.state,
        sampleRate: audioContext.sampleRate,
        nativeBackgroundCapable: nativeAvailability.backgroundCapable,
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.complete",
        sessionId,
        detail: { nativeBackgroundCapable: nativeAvailability.backgroundCapable },
      });
    } catch (err) {
      console.error("[VoiceAgent] Mic error:", err);
      recordVoiceBreadcrumb("activate.error", { message: err instanceof Error ? err.message : String(err) });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "activate.error",
        sessionId,
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      if (nativeAvailability.available) {
        await requestWakeLock();
        setIsActive(true);
        setState("listening");
        recordVoiceBreadcrumb("activate.native-fallback");
        setError("Native mic session active; browser recording is unavailable until native upload is enabled.");
      } else {
        setError("Microphone access denied. Please allow mic access and retry.");
      }
    }
  }, [agent, channelId, companyId, gatewayAgent, isAgentMuted, isMicMuted, isPlayingAudio, onAgentMutedChange, onMicMutedChange, recordVoiceBreadcrumb, requestWakeLock, sessionKey, startRealtimeRelay]);

  const deactivate = useCallback((options: { silence?: boolean } = {}) => {
    const sessionId = diagnosticSessionRef.current ?? undefined;
    recordVoiceBreadcrumb("deactivate.start", { silence: Boolean(options.silence) });
    if (options.silence) {
      onMicMutedChange?.(true);
      onAgentMutedChange?.(true);
      if (isPlayingAudio) {
        onInterrupt();
      }
    }
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "deactivate.start",
      sessionId,
      detail: {
        hasStream: Boolean(streamRef.current),
        hasRealtimeRelay: Boolean(realtimeRelayRef.current),
        audioContextState: audioContextRef.current?.state ?? null,
        mediaRecorderState: mediaRecorderRef.current?.state ?? null,
        nativeSessionActive: nativeSessionActiveRef.current,
        rafActive: Boolean(rafRef.current),
        vadFrames: vadFrameCountRef.current,
      },
    });

    if (nativeSessionActiveRef.current) {
      void stopNativeVoiceSession().catch((error) => {
        recordVoiceBreadcrumb("native-voice.stop.error", { message: error instanceof Error ? error.message : String(error) });
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "native-voice.stop.error",
          sessionId,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      });
    }
    if (realtimeRelayRef.current) {
      realtimeRelayRef.current.stop();
      realtimeRelayRef.current = null;
      setRealtimeSession(null);
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "realtime.relay.stop",
        sessionId,
      });
    }
    nativeVoiceSessionIdRef.current = null;
    nativeSessionActiveRef.current = false;
    setNativeSessionActive(false);
    // Stop VAD loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "vad.raf.cancel",
        sessionId,
      });
    }

    // Stop recording
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    isRecordingRef.current = false;

    // Release mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "media-stream.release",
        sessionId,
      });
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch((error) => {
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "audio-context.close.error",
          sessionId,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "audio-context.close",
        sessionId,
      });
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    // Release wake lock
    releaseWakeLock();

    setIsActive(false);
    setState("idle");
    setVolumeLevel(0);
    recordVoiceBreadcrumb("deactivate.complete");
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "deactivate.complete",
      sessionId,
    });
    diagnosticSessionRef.current = null;
  }, [isPlayingAudio, onAgentMutedChange, onInterrupt, onMicMutedChange, recordVoiceBreadcrumb, releaseWakeLock]);

  useEffect(() => {
    deactivateRef.current = () => deactivate();
  }, [deactivate]);

  // Lock screen orientation while voice agent is active (prevents rotation issues)
  useOrientationLock(isActive);

  useEffect(() => {
    if (!isActive) return;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMicMuted;
    });
    realtimeRelayRef.current?.setMicMuted(isMicMuted);
    if (nativeSessionActive) {
      void setNativeVoiceSessionMuted(isMicMuted).catch((error) => {
        recordVoiceBreadcrumb("native-voice.mute.error", { message: error instanceof Error ? error.message : String(error) });
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "native-voice.mute.error",
          sessionId: diagnosticSessionRef.current ?? undefined,
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      });
    }
    if (isMicMuted) {
      if (isRecordingRef.current) {
        discardRecordingRef.current = true;
      }
      stopRecording();
      speechStartTimeRef.current = 0;
      silenceStartTimeRef.current = 0;
      setVolumeLevel(0);
    }
  }, [isActive, isMicMuted, nativeSessionActive, recordVoiceBreadcrumb, stopRecording]);

  useEffect(() => {
    if (isAgentMuted) {
      realtimeRelayRef.current?.stopOutput();
    }
  }, [isAgentMuted]);

  useEffect(() => {
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const installListeners = async () => {
      const levelHandle = await addNativeVoiceSessionListener("voiceLevel", (event) => {
        if (disposed || !nativeSessionActiveRef.current || isMicMuted || streamRef.current) return;
        const level = typeof event.level === "number" ? event.level : 0;
        setVolumeLevel(Math.max(0, Math.min(1, level)));
        if (level > 0.02) {
          recordVoiceBreadcrumb("native.level.active", {
            level,
            rms: typeof event.rms === "number" ? event.rms : undefined,
            threshold: typeof event.threshold === "number" ? event.threshold : undefined,
          });
        }
      });
      if (levelHandle) handles.push(levelHandle);

      const diagnosticHandle = await addNativeVoiceSessionListener("voiceSessionDiagnostic", (event) => {
        if (disposed) return;
        recordVoiceBreadcrumb(
          typeof event.event === "string" ? `native.${event.event}` : "native.event",
          event,
        );
        publishAgentModeDiagnostic({
          scope: "native-voice-session",
          event: typeof event.event === "string" ? event.event : "native.event",
          sessionId: nativeVoiceSessionIdRef.current ?? diagnosticSessionRef.current ?? undefined,
          detail: event,
        });
      });
      if (diagnosticHandle) handles.push(diagnosticHandle);

      const transcriptHandle = await addNativeVoiceSessionListener("voiceTranscript", (event) => {
        if (disposed) return;
        const text = typeof event.text === "string" ? event.text.trim() : "";
        publishAgentModeDiagnostic({
          scope: "native-voice-session",
          event: text ? "native.transcript.received" : "native.transcript.empty",
          sessionId: nativeVoiceSessionIdRef.current ?? diagnosticSessionRef.current ?? undefined,
          detail: event,
        });
        if (text) {
          recordVoiceBreadcrumb("native.transcript.received", { characters: text.length });
          setError(null);
          setState("processing");
          onTranscript(text);
        } else if (typeof event.error === "string" && event.error) {
          recordVoiceBreadcrumb("native.transcript.error", { error: event.error });
          setError(event.error);
          setState("listening");
        }
      });
      if (transcriptHandle) handles.push(transcriptHandle);
    };

    void installListeners().catch((error) => {
      recordVoiceBreadcrumb("native-voice.listener.error", { message: error instanceof Error ? error.message : String(error) });
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "native-voice.listener.error",
        sessionId: diagnosticSessionRef.current ?? undefined,
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
    });

    return () => {
      disposed = true;
      for (const handle of handles) {
        void handle.remove();
      }
    };
  }, [isMicMuted, onTranscript, recordVoiceBreadcrumb]);

  useEffect(() => {
    if (!nativeSessionActive) return;

    let disposed = false;
    const interval = window.setInterval(() => {
      void getNativeVoiceSessionStatus()
        .then((status) => {
          if (disposed || !status) return;
          nativeSessionActiveRef.current = Boolean(status.active);
          if (status.state === "recording") {
            setState("listening");
          } else if (status.state === "transcribing") {
            setState("processing");
          } else if (status.state === "error" && status.lastError) {
            setError(status.lastError);
          }
          publishAgentModeDiagnostic({
            scope: "native-voice-session",
            event: "status.poll",
            sessionId: nativeVoiceSessionIdRef.current ?? diagnosticSessionRef.current ?? undefined,
            detail: status,
          });
        })
        .catch((error) => {
          if (disposed) return;
          recordVoiceBreadcrumb("native.status.error", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [nativeSessionActive, recordVoiceBreadcrumb]);

  // Re-acquire wake lock when page becomes visible (iOS releases on tab switch)
  useEffect(() => {
    if (!isActive) return;
    const handleVisibility = () => {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "visibility.change",
        sessionId: diagnosticSessionRef.current ?? undefined,
        detail: { visibilityState: document.visibilityState, hasWakeLock: Boolean(wakeLockRef.current) },
      });
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestWakeLock();
      }
    };
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "visibility.listener.add",
      sessionId: diagnosticSessionRef.current ?? undefined,
    });
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "visibility.listener.remove",
        sessionId: diagnosticSessionRef.current ?? undefined,
      });
    };
  }, [isActive, requestWakeLock]);

  // Survive orientation changes: resume suspended AudioContext, re-acquire wake lock,
  // and restart VAD loop if it was interrupted by the browser during rotation.
  useEffect(() => {
    if (!isActive) return;

    const handleOrientationChange = async () => {
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "orientation-or-resize",
        sessionId: diagnosticSessionRef.current ?? undefined,
        detail: {
          audioContextState: audioContextRef.current?.state ?? null,
          hasWakeLock: Boolean(wakeLockRef.current),
          rafActive: Boolean(rafRef.current),
        },
      });
      // AudioContext may be suspended by the browser during orientation animation
      if (audioContextRef.current?.state === "suspended") {
        try {
          await audioContextRef.current.resume();
        } catch {
          // Non-critical — VAD will restart when context resumes naturally
        }
      }

      // Wake lock is released by some browsers on orientation change
      if (!wakeLockRef.current) {
        requestWakeLock();
      }

      // If the VAD rAF loop died (rafRef is 0 but we're still active), restart it
      if (rafRef.current === 0 && analyserRef.current) {
        runVAD();
      }
    };

    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("resize", handleOrientationChange);
    publishAgentModeDiagnostic({
      scope: "voice-agent",
      event: "orientation.listeners.add",
      sessionId: diagnosticSessionRef.current ?? undefined,
    });

    return () => {
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("resize", handleOrientationChange);
      publishAgentModeDiagnostic({
        scope: "voice-agent",
        event: "orientation.listeners.remove",
        sessionId: diagnosticSessionRef.current ?? undefined,
      });
    };
  }, [isActive, requestWakeLock, runVAD]);

  // Start/stop VAD loop when active
  useEffect(() => {
    if (isActive && analyserRef.current) {
      runVAD();
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        publishAgentModeDiagnostic({
          scope: "voice-agent",
          event: "vad.raf.cancel",
          sessionId: diagnosticSessionRef.current ?? undefined,
        });
      }
    };
  }, [isActive, runVAD]);

  useEffect(() => {
    if (!autoActivate || isActive || hasAutoActivatedRef.current) return;
    hasAutoActivatedRef.current = true;
    void activate();
  }, [activate, autoActivate, isActive]);

  // Update state based on external signals
  useEffect(() => {
    if (!isActive) return;
    if (isPlayingAudio) {
      setState("speaking");
    } else if (isLoading) {
      setState("processing");
    } else if (isMicMuted) {
      setState("muted");
    } else if (!isRecordingRef.current) {
      setState("listening");
    }
  }, [isActive, isMicMuted, isPlayingAudio, isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => deactivateRef.current();
  }, []);

  const stateLabel: Record<AgentState, string> = {
    idle: "ACTIVATE AGENT",
    listening: "LISTENING",
    processing: "THINKING",
    speaking: "SPEAKING",
    muted: "MUTED",
  };

  const listeningColor = "rgb(var(--voice-listening-rgb))";
  const speakingColor = "rgb(var(--voice-speaking-rgb))";
  const processingColor = "rgb(var(--voice-processing-rgb))";
  const accentRgb = hexToRgb(accentColor);
  const listeningRgb = "var(--voice-listening-rgb)";
  const speakingRgb = "var(--voice-speaking-rgb)";
  const processingRgb = "var(--voice-processing-rgb)";
  const stateColor =
    isMicMuted && !isPlayingAudio && !isLoading
      ? "var(--text-tertiary)"
      : state === "listening"
      ? listeningColor
      : state === "processing"
        ? processingColor
        : state === "speaking"
          ? speakingColor
          : "var(--text-tertiary)";
  const glowStrength = state === "idle" ? 0.16 : 0.28 + volumeLevel * 0.32;
  const realtimeRelayActive = Boolean(realtimeRelayRef.current);
  const baseReactiveLevel = state === "speaking"
    ? 0.36
    : state === "listening"
      ? 0.22
      : state === "processing"
        ? 0.28
        : 0;
  const visualVolume = Math.min(1, Math.max(baseReactiveLevel, volumeLevel * (nativeSessionActive || realtimeRelayActive ? 1.25 : 0.8)));
  const motionLevel =
    state === "speaking"
      ? Math.min(0.82, 0.24 + visualVolume * 0.78)
      : state === "listening"
        ? Math.min(0.58, visualVolume)
        : state === "processing"
          ? Math.min(0.34, 0.18 + visualVolume * 0.32)
          : 0;
  const haloSize = immersive ? 285 + motionLevel * 75 : compact ? 104 + motionLevel * 28 : 170 + motionLevel * 90;
  const orbScale = immersive
    ? 1.22 + motionLevel * (state === "speaking" ? 0.06 : 0.045)
    : 1 + motionLevel * 0.06;
  const listeningActive = isActive && state === "listening";
  const speakingActive = isActive && state === "speaking" && !isAgentMuted;
  const thinkingActive = isActive && state === "processing";
  const showCompactStatus = !immersive;
  const displayState: AgentState = isMicMuted && !isPlayingAudio && !isLoading ? "muted" : state;
  const readinessTone = realtimeReadiness?.status === "ready"
    ? "var(--success)"
    : realtimeReadiness?.status === "microphone-denied"
      ? "var(--danger)"
      : "var(--warning)";
  const readinessMessage = realtimeReadiness?.status === "ready"
    ? realtimeReadiness.message
    : realtimeReadiness?.status === "microphone-denied"
      ? realtimeReadiness.message
      : realtimeReadiness
        ? `Realtime unavailable; classic STT/TTS fallback will be used. ${realtimeReadiness.message}`
        : null;

  return (
    <div className={`flex w-full flex-col items-center ${immersive ? "gap-8 py-0" : compact ? "gap-1.5 py-0" : "gap-2 py-1"}`}>
      {readinessMessage && (
        <div
          className="w-full max-w-sm rounded-2xl border px-4 py-2 text-center text-[11px]"
          style={{
            backgroundColor: `color-mix(in srgb, ${readinessTone} 10%, transparent)`,
            borderColor: `color-mix(in srgb, ${readinessTone} 24%, transparent)`,
            color: readinessTone,
          }}
          data-realtime-readiness={realtimeReadiness?.status}
        >
          {readinessMessage}
        </div>
      )}
      {error && (
        <div
          className="w-full max-w-sm rounded-2xl border px-4 py-2 text-center text-[11px]"
          style={{
            backgroundColor: "color-mix(in srgb, var(--danger) 10%, transparent)",
            borderColor: "color-mix(in srgb, var(--danger) 22%, transparent)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      <AgentVisualizer
        state={displayState}
        isActive={isActive}
        isRecording={isRecordingRef.current}
        compact={compact}
        immersive={immersive}
        visualVolume={visualVolume}
        motionLevel={motionLevel}
        haloSize={haloSize}
        orbScale={orbScale}
        glowStrength={glowStrength}
        activeRgb={accentRgb}
        listeningRgb={listeningRgb}
        speakingRgb={speakingRgb}
        processingRgb={processingRgb}
        listeningColor={listeningColor}
        speakingColor={speakingColor}
        onToggle={isActive ? () => deactivate({ silence: true }) : activate}
        settings={visualSettings}
      />

      {showCompactStatus ? (
        <div className="flex flex-col items-center gap-1.5">
          <span
            className={`${compact ? "px-3 py-1 text-[9px] tracking-[0.2em]" : "px-4 py-1.5 text-[11px] tracking-[0.28em]"} rounded-full border font-medium transition-colors duration-300`}
            style={{
              color: stateColor,
              borderColor: state === "idle" ? "var(--border-medium)" : `color-mix(in srgb, ${stateColor} 32%, transparent)`,
              backgroundColor: state === "idle" ? "var(--bg-surface)" : `color-mix(in srgb, ${stateColor} 10%, transparent)`,
            }}
          >
            {stateLabel[displayState]}
          </span>
          {isActive && !compact && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onMicMutedChange?.(!isMicMuted)}
                aria-pressed={isMicMuted}
                title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                className={`${compact ? "min-h-8 min-w-16 px-3 py-1.5 text-[9px] tracking-[0.16em]" : "min-h-11 min-w-24 px-5 py-3 text-[11px] tracking-[0.2em] sm:min-h-10 sm:min-w-20 sm:px-4 sm:py-2"} rounded-full border font-medium transition ${
                  isMicMuted
                    ? "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                }`}
              >
                MIC
              </button>
              <button
                type="button"
                onClick={() => onAgentMutedChange?.(!isAgentMuted)}
                aria-pressed={isAgentMuted}
                title={isAgentMuted ? "Unmute agent audio" : "Mute agent audio"}
                className={`${compact ? "min-h-8 min-w-16 px-3 py-1.5 text-[9px] tracking-[0.16em]" : "min-h-11 min-w-24 px-5 py-3 text-[11px] tracking-[0.2em] sm:min-h-10 sm:min-w-20 sm:px-4 sm:py-2"} rounded-full border font-medium transition ${
                  isAgentMuted
                    ? "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                }`}
              >
                AGENT
              </button>
            </div>
          )}
          {isActive && !compact && (
            <span className="text-center text-[11px] tracking-[0.16em] text-[var(--text-tertiary)]">
              {isMicMuted
                ? "MIC MUTED"
                : state === "speaking"
                ? "SPEAK TO INTERRUPT"
                : state === "listening"
                  ? nativeSessionActive && nativeBackgroundCapable
                    ? "NATIVE MIC SESSION ACTIVE"
                    : realtimeRelayActive
                      ? "REALTIME RELAY ACTIVE"
                    : "SPEAK NATURALLY"
                  : state === "processing"
                    ? "THINKING"
                  : ""}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-2 py-2 text-[10px] uppercase tracking-[0.22em] text-[var(--text-secondary)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => onMicMutedChange?.(!isMicMuted)}
            aria-pressed={isMicMuted}
            title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
              isMicMuted
                ? "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                : "hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full transition-all ${listeningActive ? "animate-pulse" : ""}`}
              style={{
                backgroundColor: listeningColor,
                boxShadow: listeningActive && !isMicMuted ? `0 0 14px rgba(${listeningRgb}, 0.9)` : "none",
                opacity: isMicMuted ? 0.16 : listeningActive ? 1 : 0.35,
              }}
            />
            Mic
          </button>
          <span className="h-4 w-px bg-[var(--border-subtle)]" />
          {nativeSessionActive && nativeBackgroundCapable ? (
            <span className="rounded-full bg-[var(--bg-surface-hover)] px-3 py-1.5 text-[9px] tracking-[0.18em] text-[var(--text-tertiary)]">
              Native iOS
            </span>
          ) : null}
          {realtimeRelayActive ? (
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[9px] tracking-[0.18em] text-[var(--accent)]">
              Realtime
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onAgentMutedChange?.(!isAgentMuted)}
            aria-pressed={isAgentMuted}
            title={isAgentMuted ? "Unmute agent audio" : "Mute agent audio"}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
              isAgentMuted
                ? "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                : "hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full transition-all ${speakingActive ? "animate-pulse" : ""}`}
              style={{
                backgroundColor: speakingColor,
                boxShadow: speakingActive && !isAgentMuted ? `0 0 14px rgba(${speakingRgb},0.9)` : "none",
                opacity: isAgentMuted ? 0.16 : speakingActive ? 1 : thinkingActive ? 0.7 : 0.35,
              }}
            />
            Agent
          </button>
        </div>
      )}

      {isActive && !immersive && !compact && (
        <div className="flex h-8 items-end gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-4 py-1.5">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="w-[4px] rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(
                  4,
                  Math.min(
                    18,
                    volumeLevel * 18 * (0.45 + Math.random() * 0.65)
                  )
                )}px`,
                backgroundColor:
                  state === "listening"
                    ? listeningColor
                    : state === "speaking"
                      ? speakingColor
                      : state === "processing"
                        ? processingColor
                        : "var(--text-tertiary)",
                opacity:
                  i / 24 < volumeLevel
                    ? 0.3 + volumeLevel * 0.7
                    : 0.14,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
