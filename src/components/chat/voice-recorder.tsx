"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  isDisabled?: boolean;
}

const MIN_RECORDING_MS = 300;

export function VoiceRecorder({ onTranscript, isDisabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    // MediaRecorder is available in all modern browsers, no HTTPS required for getUserMedia on localhost
    setIsSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const startRecording = useCallback(async () => {
    if (isDisabled || isTranscribing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Release mic immediately
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        const duration = Date.now() - startTimeRef.current;
        if (duration < MIN_RECORDING_MS || chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setIsTranscribing(true);

        try {
          const formData = new FormData();
          formData.append("audio", blob, "audio.webm");

          const response = await fetch("/api/stt", {
            method: "POST",
            body: formData,
          });

          if (response.ok) {
            const { text } = await response.json();
            if (text?.trim()) {
              onTranscript(text.trim());
            }
          } else {
            console.error("[VoiceRecorder] STT error:", response.status);
          }
        } catch (err) {
          console.error("[VoiceRecorder] Transcription error:", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
    } catch (err) {
      console.error("[VoiceRecorder] Mic error:", err);
    }
  }, [isDisabled, isTranscribing, onTranscript]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  if (!isSupported) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-tertiary)] text-center">
          Transcribing...
        </div>
      )}

      {/* Hold-to-record button */}
      <button
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={() => {
          if (isRecording) stopRecording();
        }}
        disabled={isDisabled || isTranscribing}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all duration-200 select-none touch-none ${
          isRecording
            ? "border-neo bg-neo/20 scale-110"
            : isTranscribing
              ? "border-amber-400/50 bg-amber-400/10"
              : "border-[var(--text-tertiary)] bg-[var(--bg-surface-hover)] hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
        } ${isDisabled || isTranscribing ? "opacity-40 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
        style={
          isRecording
            ? { boxShadow: "0 0 30px rgba(0, 240, 255, 0.3), 0 0 60px rgba(0, 240, 255, 0.1)" }
            : undefined
        }
      >
        {/* Mic icon */}
        <svg
          className={`h-7 w-7 transition-colors ${
            isRecording ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
          }`}
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

        {/* Pulsing ring when recording */}
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded-full border-2 border-neo/40 animate-ping" />
            <span className="absolute inset-[-4px] rounded-full border border-neo/20 animate-pulse" />
          </>
        )}
      </button>

      <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
        {isRecording ? "RELEASE TO SEND" : isTranscribing ? "TRANSCRIBING..." : "HOLD TO SPEAK"}
      </span>
    </div>
  );
}
