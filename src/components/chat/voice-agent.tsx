"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useOrientationLock } from "@/hooks/use-orientation-lock";

type AgentState = "listening" | "processing" | "speaking" | "idle";

interface VoiceAgentProps {
  onTranscript: (text: string) => void;
  isPlayingAudio: boolean;
  onInterrupt: () => void;
  isLoading: boolean;
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

  return (
    <div className="flex flex-col items-center gap-4 py-4 landscape:gap-2 landscape:py-2">
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {/* Agent orb */}
      <button
        onClick={isActive ? deactivate : activate}
        className="relative flex items-center justify-center select-none"
      >
        {/* Outer glow ring */}
        <div
          className={`absolute rounded-full transition-all duration-500 landscape:scale-[0.55] ${
            isActive ? "opacity-100" : "opacity-0"
          }`}
          style={{
            width: `${100 + volumeLevel * 40}px`,
            height: `${100 + volumeLevel * 40}px`,
            background:
              state === "listening"
                ? `radial-gradient(circle, rgba(0, 240, 255, ${0.08 + volumeLevel * 0.15}) 0%, transparent 70%)`
                : state === "speaking"
                  ? `radial-gradient(circle, rgba(167, 139, 250, ${0.08 + volumeLevel * 0.15}) 0%, transparent 70%)`
                  : state === "processing"
                    ? `radial-gradient(circle, rgba(251, 191, 36, 0.08) 0%, transparent 70%)`
                    : "none",
          }}
        />

        {/* Main orb */}
        <div
          className={`relative flex h-20 w-20 landscape:h-12 landscape:w-12 items-center justify-center rounded-full border-2 transition-all duration-300 ${
            state === "idle"
              ? "border-[var(--text-tertiary)] bg-[var(--bg-surface-hover)] hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
              : state === "listening"
                ? "border-neo bg-neo/15 cursor-pointer"
                : state === "processing"
                  ? "border-amber-400/50 bg-amber-400/10 cursor-pointer"
                  : "border-violet-400/50 bg-violet-400/10 cursor-pointer"
          }`}
          style={
            state === "listening"
              ? {
                  boxShadow: `0 0 ${20 + volumeLevel * 30}px rgba(0, 240, 255, ${0.2 + volumeLevel * 0.3})`,
                  transform: `scale(${1 + volumeLevel * 0.08})`,
                }
              : state === "speaking"
                ? {
                    boxShadow:
                      "0 0 30px rgba(167, 139, 250, 0.25), 0 0 60px rgba(167, 139, 250, 0.1)",
                  }
                : state === "processing"
                  ? {
                      boxShadow: "0 0 20px rgba(251, 191, 36, 0.15)",
                    }
                  : undefined
          }
        >
          {/* Icon based on state */}
          {state === "idle" ? (
            // Power icon
            <svg
              className="h-8 w-8 landscape:h-5 landscape:w-5 text-[var(--text-tertiary)]"
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
            // Mic icon with pulse
            <>
              <svg
                className="h-8 w-8 landscape:h-5 landscape:w-5 text-neo"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                />
              </svg>
              {isRecordingRef.current && (
                <span className="absolute inset-0 rounded-full border-2 border-neo/40 animate-ping" />
              )}
            </>
          ) : state === "processing" ? (
            // Thinking spinner
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
            // Speaker icon for speaking
            <svg
              className="h-8 w-8 landscape:h-5 landscape:w-5 text-violet-400"
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

      {/* State label */}
      <div className="flex flex-col items-center gap-1 landscape:gap-0.5">
        <span
          className={`text-[11px] landscape:text-[9px] tracking-[0.2em] font-medium transition-colors duration-300 ${
            state === "idle"
              ? "text-[var(--text-tertiary)]"
              : state === "listening"
                ? "text-[var(--accent)]"
                : state === "processing"
                  ? "text-amber-400"
                  : "text-violet-400"
          }`}
        >
          {stateLabel[state]}
        </span>
        {isActive && (
          <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">
            {state === "speaking"
              ? "SPEAK TO INTERRUPT"
              : state === "listening"
                ? "SPEAK NATURALLY"
                : ""}
          </span>
        )}
      </div>

      {/* Volume meter */}
      {isActive && (
        <div className="flex items-center gap-[2px] h-4 landscape:h-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-all duration-75 ${
                state === "listening"
                  ? "bg-[var(--accent)]"
                  : state === "speaking"
                    ? "bg-violet-400"
                    : "bg-[var(--text-tertiary)]"
              }`}
              style={{
                height: `${Math.max(
                  2,
                  Math.min(
                    16,
                    volumeLevel * 16 * (0.5 + Math.random() * 0.5)
                  )
                )}px`,
                opacity:
                  i / 20 < volumeLevel
                    ? 0.3 + volumeLevel * 0.7
                    : 0.1,
              }}
            />
          ))}
        </div>
      )}

    </div>
  );
}
