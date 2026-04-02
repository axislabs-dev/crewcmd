"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any;

function getBrowserSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  isDisabled?: boolean;
}

const MIN_RECORDING_MS = 300;

/**
 * Compact inline mic button — hold to record, release to transcribe.
 * Sits alongside the text input and send button.
 */
export function VoiceRecorder({ onTranscript, isDisabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [sttMode, setSttMode] = useState<"server" | "browser" | "unknown">("unknown");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const browserRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const hasMediaRecorder = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    const hasBrowserSpeech = !!getBrowserSpeechRecognition();
    setIsSupported(hasMediaRecorder || hasBrowserSpeech);

    // Probe server STT availability on mount
    fetch("/api/stt")
      .then((res) => {
        if (res.status === 503) {
          setSttMode("browser");
        } else if (res.ok) {
          setSttMode("server");
        } else {
          setSttMode(hasBrowserSpeech ? "browser" : "server");
        }
      })
      .catch(() => {
        setSttMode(hasBrowserSpeech ? "browser" : "server");
      });
  }, []);

  // Browser Speech API fallback
  const startBrowserRecording = useCallback(() => {
    const SpeechRecognitionClass = getBrowserSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    let transcript = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error("[VoiceRecorder] Browser speech error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
    };

    browserRecognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [onTranscript]);

  const stopBrowserRecording = useCallback(() => {
    if (browserRecognitionRef.current) {
      browserRecognitionRef.current.stop();
      browserRecognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Server-side recording (MediaRecorder + /api/stt)
  const startServerRecording = useCallback(async () => {
    if (!navigator.mediaDevices) {
      console.error("[VoiceRecorder] mediaDevices unavailable — requires HTTPS");
      setIsRecording(false);
      return;
    }
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
          } else if (response.status === 503) {
            setSttMode("browser");
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
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    if (isDisabled || isTranscribing) return;
    if (sttMode === "browser") {
      startBrowserRecording();
    } else {
      await startServerRecording();
    }
  }, [isDisabled, isTranscribing, sttMode, startBrowserRecording, startServerRecording]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (sttMode === "browser") {
      stopBrowserRecording();
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, [sttMode, stopBrowserRecording]);

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
    <button
      onPointerDown={startRecording}
      onPointerUp={stopRecording}
      onPointerLeave={() => {
        if (isRecording) stopRecording();
      }}
      disabled={isDisabled || isTranscribing}
      title={isRecording ? "Release to send" : isTranscribing ? "Transcribing..." : "Hold to speak"}
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 select-none touch-none ${
        isRecording
          ? "bg-neo/20 scale-105"
          : isTranscribing
            ? "bg-amber-400/10"
            : "hover:bg-[var(--bg-surface-hover)]"
      } ${isDisabled || isTranscribing ? "opacity-40 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
      style={
        isRecording
          ? { boxShadow: "0 0 20px rgba(0, 240, 255, 0.25)" }
          : undefined
      }
    >
      {isTranscribing ? (
        /* Spinner while transcribing */
        <div className="flex items-center gap-0.5">
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" style={{ animationDelay: "0.15s" }} />
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" style={{ animationDelay: "0.3s" }} />
        </div>
      ) : (
        /* Mic icon */
        <svg
          className={`h-[18px] w-[18px] transition-colors ${
            isRecording ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"
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
      )}

      {/* Pulsing ring when recording */}
      {isRecording && (
        <span className="absolute inset-0 rounded-lg border border-neo/40 animate-ping" />
      )}
    </button>
  );
}
