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
 * Toggle mic button — tap to start recording, shows VU meter + done/cancel while active.
 * Replaces old hold-to-talk approach.
 */
export function VoiceRecorder({ onTranscript, isDisabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [sttMode, setSttMode] = useState<"server" | "browser" | "unknown">("unknown");
  const [volumeLevel, setVolumeLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const browserRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const hasMediaRecorder = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    const hasBrowserSpeech = !!getBrowserSpeechRecognition();
    setIsSupported(hasMediaRecorder || hasBrowserSpeech);

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

  // VU meter animation loop
  const startVUMeter = useCallback((stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setVolumeLevel(Math.min(rms * 12, 1));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // AudioContext not available, VU meter just won't animate
    }
  }, []);

  const stopVUMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setVolumeLevel(0);
  }, []);

  // Browser Speech API
  const startBrowserRecording = useCallback(async () => {
    const SpeechRecognitionClass = getBrowserSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    // Get mic stream for VU meter even with browser STT
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startVUMeter(stream);
    } catch {
      // VU meter just won't work
    }

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
      stopVUMeter();
      setIsRecording(false);
    };

    recognition.onend = () => {
      stopVUMeter();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
    };

    browserRecognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [onTranscript, startVUMeter, stopVUMeter]);

  // Server-side recording
  const startServerRecording = useCallback(async () => {
    if (!navigator.mediaDevices) {
      console.error("[VoiceRecorder] mediaDevices unavailable — requires HTTPS");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      startVUMeter(stream);

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopVUMeter();
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
  }, [onTranscript, startVUMeter, stopVUMeter]);

  const toggleRecording = useCallback(async () => {
    if (isDisabled || isTranscribing) return;
    if (isRecording) {
      // Stop = submit
      if (sttMode === "browser") {
        if (browserRecognitionRef.current) {
          browserRecognitionRef.current.stop();
          browserRecognitionRef.current = null;
        }
      } else if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      setIsRecording(false);
    } else {
      // Start
      if (sttMode === "browser") {
        await startBrowserRecording();
      } else {
        await startServerRecording();
      }
    }
  }, [isDisabled, isTranscribing, isRecording, sttMode, startBrowserRecording, startServerRecording]);

  const cancelRecording = useCallback(() => {
    stopVUMeter();
    if (sttMode === "browser") {
      if (browserRecognitionRef.current) {
        // Detach handlers to prevent onend from sending transcript
        browserRecognitionRef.current.onresult = null;
        browserRecognitionRef.current.onend = () => setIsRecording(false);
        browserRecognitionRef.current.stop();
        browserRecognitionRef.current = null;
      }
    } else if (mediaRecorderRef.current) {
      // Detach onstop to prevent transcription
      mediaRecorderRef.current.onstop = () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, [sttMode, stopVUMeter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVUMeter();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stopVUMeter]);

  if (!isSupported) return null;

  // When recording: show VU meter with cancel (X) and done (checkmark) buttons
  if (isRecording) {
    return (
      <div className="flex items-center gap-2">
        {/* Cancel button */}
        <button
          onClick={cancelRecording}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-400/10 transition-all"
          title="Cancel recording"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* VU meter bars */}
        <div className="flex items-center gap-[2px] h-6 px-1">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-[var(--accent)] transition-all duration-75"
              style={{
                height: `${Math.max(3, Math.min(20, volumeLevel * 20 * (0.4 + Math.random() * 0.6)))}px`,
                opacity: i / 16 < volumeLevel ? 0.4 + volumeLevel * 0.6 : 0.15,
              }}
            />
          ))}
        </div>

        {/* Done / submit button */}
        <button
          onClick={toggleRecording}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--bg-primary)] transition-all hover:opacity-90"
          title="Send recording"
          style={{ boxShadow: "0 0 12px rgba(0, 240, 255, 0.25)" }}
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </button>
      </div>
    );
  }

  // Transcribing state
  if (isTranscribing) {
    return (
      <div className="flex h-8 w-8 items-center justify-center">
        <div className="flex items-center gap-0.5">
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" style={{ animationDelay: "0.15s" }} />
          <span className="h-1 w-1 rounded-full bg-amber-400/70 animate-pulse" style={{ animationDelay: "0.3s" }} />
        </div>
      </div>
    );
  }

  // Default: mic icon button
  return (
    <button
      onClick={toggleRecording}
      disabled={isDisabled}
      title="Start voice input"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-all hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <svg
        className="h-[18px] w-[18px]"
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
    </button>
  );
}
