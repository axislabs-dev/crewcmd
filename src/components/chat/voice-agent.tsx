"use client";

import type { CSSProperties } from "react";
import { useRef, useState, useCallback, useEffect } from "react";
import { useOrientationLock } from "@/hooks/use-orientation-lock";

type AgentState = "listening" | "processing" | "speaking" | "idle";

interface VoiceAgentProps {
  onTranscript: (text: string) => void;
  isPlayingAudio: boolean;
  onInterrupt: () => void;
  isLoading: boolean;
  accentColor?: string;
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

export function VoiceAgent({
  onTranscript,
  isPlayingAudio,
  onInterrupt,
  isLoading,
  accentColor = "#63b7aa",
}: VoiceAgentProps) {
  const [state, setState] = useState<AgentState>("idle");
  const [isActive, setIsActive] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);

  // VAD timing refs
  const speechStartTimeRef = useRef<number>(0);
  const silenceStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);

  const transcribe = useCallback(
    async (audioBlob: Blob) => {
      setState("processing");
      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "audio.webm");

        const response = await fetch("/api/stt", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          setError(response.status === 503
            ? "Speech server unavailable. Deactivate and retry."
            : "Transcription failed. Try speaking again.");
          setState("listening");
          return;
        }

        const { text } = await response.json();
        if (text && text.trim()) {
          setError(null);
          onTranscript(text.trim());
        } else {
          setState("listening");
        }
      } catch {
        setError("Speech server unreachable. Check your connection.");
        setState("listening");
      }
    },
    [onTranscript]
  );

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    if (isRecordingRef.current || !streamRef.current) return;
    isRecordingRef.current = true;
    recordingStartTimeRef.current = Date.now();
    chunksRef.current = [];

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const duration = Date.now() - recordingStartTimeRef.current;
      if (duration >= MIN_RECORDING_MS && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        transcribe(blob);
      } else {
        setState("listening");
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start(100); // collect in 100ms chunks
  }, [transcribe]);

  // VAD loop using AnalyserNode
  const runVAD = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // When TTS is playing, show a synthetic pulse on the VU meter
      // (mic RMS is near-zero during playback so bars would be dead)
      if (isPlayingAudio) {
        const t = Date.now() / 1000;
        const pulse = 0.3 + 0.25 * Math.sin(t * 2.5) + 0.15 * Math.sin(t * 4.1) + 0.1 * Math.sin(t * 7.3);
        setVolumeLevel(Math.min(pulse, 1));
      } else {
        setVolumeLevel(Math.min(rms * 10, 1)); // normalize for UI
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
  }, [isPlayingAudio, onInterrupt, startRecording, stopRecording]);

  // Screen Wake Lock — keeps screen on during agent mode (mobile)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // Wake lock can fail if battery is low or OS denies it — non-critical
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  const activate = useCallback(async () => {
    setError(null);

    // mediaDevices requires a secure context (HTTPS or localhost)
    if (!navigator.mediaDevices) {
      setError("Voice requires HTTPS. Access via localhost or run: pnpm dev:https");
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

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

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
    } catch (err) {
      console.error("[VoiceAgent] Mic error:", err);
      setError("Microphone access denied. Please allow mic access and retry.");
    }
  }, [requestWakeLock]);

  const deactivate = useCallback(() => {
    // Stop VAD loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
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
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    // Release wake lock
    releaseWakeLock();

    setIsActive(false);
    setState("idle");
    setVolumeLevel(0);
  }, [releaseWakeLock]);

  // Lock screen orientation while voice agent is active (prevents rotation issues)
  useOrientationLock(isActive);

  // Re-acquire wake lock when page becomes visible (iOS releases on tab switch)
  useEffect(() => {
    if (!isActive) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isActive, requestWakeLock]);

  // Survive orientation changes: resume suspended AudioContext, re-acquire wake lock,
  // and restart VAD loop if it was interrupted by the browser during rotation.
  useEffect(() => {
    if (!isActive) return;

    const handleOrientationChange = async () => {
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

    return () => {
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("resize", handleOrientationChange);
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
      }
    };
  }, [isActive, runVAD]);

  // Update state based on external signals
  useEffect(() => {
    if (!isActive) return;
    if (isPlayingAudio) {
      setState("speaking");
    } else if (isLoading) {
      setState("processing");
    } else if (!isRecordingRef.current) {
      setState("listening");
    }
  }, [isActive, isPlayingAudio, isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => deactivate();
  }, [deactivate]);

  const stateLabel: Record<AgentState, string> = {
    idle: "ACTIVATE AGENT",
    listening: "LISTENING",
    processing: "THINKING",
    speaking: "SPEAKING",
  };

  const accentRgb = hexToRgb(accentColor);
  const stateColor =
    state === "listening"
      ? accentColor
      : state === "processing"
        ? "#fbbf24"
        : state === "speaking"
          ? "#c084fc"
          : "var(--text-tertiary)";
  const glowStrength = state === "idle" ? 0.16 : 0.28 + volumeLevel * 0.32;

  return (
    <div className="flex w-full flex-col items-center gap-5 py-3">
      {error && (
        <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-center text-[11px] text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={isActive ? deactivate : activate}
        className="voice-agent-reactor relative flex h-[18rem] w-[18rem] max-w-full items-center justify-center rounded-full select-none transition-transform duration-300 hover:scale-[1.01] sm:h-[20rem] sm:w-[20rem]"
        style={
          {
            "--voice-accent-rgb": accentRgb,
          } as CSSProperties
        }
      >
        <div
          className="absolute inset-[8%] rounded-full blur-3xl transition-all duration-500"
          style={{
            background:
              state === "speaking"
                ? `radial-gradient(circle, rgba(192,132,252,${0.18 + volumeLevel * 0.18}) 0%, transparent 68%)`
                : state === "processing"
                  ? "radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 68%)"
                  : `radial-gradient(circle, rgba(${accentRgb}, ${glowStrength}) 0%, transparent 68%)`,
          }}
        />

        <div className="voice-agent-ring voice-agent-ring-outer" />
        <div className="voice-agent-ring voice-agent-ring-middle" />
        <div className="voice-agent-ring voice-agent-ring-inner" />
        <div className="voice-agent-grid" />

        <div
          className={`absolute rounded-full transition-all duration-500 ${isActive ? "opacity-100" : "opacity-0"}`}
          style={{
            width: `${170 + volumeLevel * 90}px`,
            height: `${170 + volumeLevel * 90}px`,
            background:
              state === "listening"
                ? `radial-gradient(circle, rgba(${accentRgb}, ${0.11 + volumeLevel * 0.16}) 0%, transparent 70%)`
                : state === "speaking"
                  ? `radial-gradient(circle, rgba(167, 139, 250, ${0.08 + volumeLevel * 0.15}) 0%, transparent 70%)`
                : state === "processing"
                    ? `radial-gradient(circle, rgba(251, 191, 36, 0.08) 0%, transparent 70%)`
                    : "none",
          }}
        />

        <div
          className={`voice-agent-core relative flex h-34 w-34 items-center justify-center rounded-full border transition-all duration-300 sm:h-40 sm:w-40 ${
            state === "idle"
              ? "cursor-pointer border-[var(--border-medium)]"
              : state === "listening"
                ? "cursor-pointer"
                : state === "processing"
                  ? "cursor-pointer border-amber-400/40"
                  : "cursor-pointer border-violet-400/40"
          }`}
          style={
            state === "listening"
              ? {
                  borderColor: `rgba(${accentRgb}, ${0.48 + volumeLevel * 0.2})`,
                  background: `radial-gradient(circle, rgba(${accentRgb}, 0.24), rgba(10, 20, 29, 0.92) 72%)`,
                  boxShadow: `0 0 ${24 + volumeLevel * 34}px rgba(${accentRgb}, ${0.2 + volumeLevel * 0.28})`,
                  transform: `scale(${1 + volumeLevel * 0.06})`,
                }
              : state === "speaking"
                ? {
                    background: "radial-gradient(circle, rgba(192,132,252,0.24), rgba(16, 11, 29, 0.92) 72%)",
                    boxShadow:
                      "0 0 30px rgba(167, 139, 250, 0.25), 0 0 60px rgba(167, 139, 250, 0.1)",
                  }
                : state === "processing"
                  ? {
                      background: "radial-gradient(circle, rgba(251,191,36,0.2), rgba(28, 21, 7, 0.94) 72%)",
                      boxShadow: "0 0 20px rgba(251, 191, 36, 0.15)",
                    }
                  : {
                      background: "radial-gradient(circle, rgba(255,255,255,0.08), rgba(12, 17, 23, 0.92) 72%)",
                    }
          }
        >
          {state === "idle" ? (
            <svg
              className="h-10 w-10 text-[var(--text-tertiary)] sm:h-12 sm:w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9"
              />
            </svg>
          ) : state === "listening" ? (
            <>
              <svg
                className="h-10 w-10 sm:h-12 sm:w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke={accentColor}
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                />
              </svg>
              {isRecordingRef.current && (
                <span
                  className="absolute inset-0 rounded-full border animate-ping"
                  style={{ borderColor: `rgba(${accentRgb}, 0.45)` }}
                />
              )}
            </>
          ) : state === "processing" ? (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400/60 animate-pulse" />
              <span
                className="h-2 w-2 rounded-full bg-amber-400/60 animate-pulse"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="h-2 w-2 rounded-full bg-amber-400/60 animate-pulse"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
          ) : (
            <svg
              className="h-10 w-10 text-violet-300 sm:h-12 sm:w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
              />
            </svg>
          )}
        </div>
      </button>

      <div className="flex flex-col items-center gap-2">
        <span
          className="rounded-full border px-4 py-1.5 text-[11px] font-medium tracking-[0.28em] transition-colors duration-300"
          style={{
            color: stateColor,
            borderColor: state === "idle" ? "var(--border-medium)" : `color-mix(in srgb, ${stateColor} 32%, transparent)`,
            backgroundColor: state === "idle" ? "var(--bg-surface)" : `color-mix(in srgb, ${stateColor} 10%, transparent)`,
          }}
        >
          {stateLabel[state]}
        </span>
        {isActive && (
          <span className="text-center text-[11px] tracking-[0.16em] text-[var(--text-tertiary)]">
            {state === "speaking"
              ? "SPEAK TO INTERRUPT"
              : state === "listening"
                ? "SPEAK NATURALLY"
                : state === "processing"
                  ? "HOLD FOR A RESPONSE"
                : ""}
          </span>
        )}
      </div>

      {isActive && (
        <div className="flex h-12 items-end gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-4 py-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="w-[4px] rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(
                  4,
                  Math.min(
                    28,
                    volumeLevel * 28 * (0.45 + Math.random() * 0.65)
                  )
                )}px`,
                backgroundColor:
                  state === "listening"
                    ? accentColor
                    : state === "speaking"
                      ? "#c084fc"
                      : state === "processing"
                        ? "#fbbf24"
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
