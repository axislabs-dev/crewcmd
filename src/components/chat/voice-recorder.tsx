"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any;

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  isDisabled?: boolean;
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceRecorder({ onTranscript, isDisabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    setIsSupported(!!getSpeechRecognition());
  }, []);

  const startRecording = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass || isDisabled) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    finalTranscriptRef.current = "";
    setInterimText("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      finalTranscriptRef.current = final;
      setInterimText(interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error("[VoiceRecorder] Error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isDisabled]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);

    const text = (finalTranscriptRef.current + " " + interimText).trim();
    if (text) {
      onTranscript(text);
    }
    setInterimText("");
    finalTranscriptRef.current = "";
  }, [onTranscript, interimText]);

  if (!isSupported) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Interim transcript preview */}
      {isRecording && (interimText || finalTranscriptRef.current) && (
        <div className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] font-mono text-[12px] text-white/40 truncate">
          {finalTranscriptRef.current}{interimText}
        </div>
      )}

      {/* Hold-to-record button */}
      <button
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={() => {
          if (isRecording) stopRecording();
        }}
        disabled={isDisabled}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all duration-200 select-none touch-none ${
          isRecording
            ? "border-neo bg-neo/20 scale-110"
            : "border-white/15 bg-white/[0.05] hover:border-white/25 hover:bg-white/[0.08]"
        } ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
        style={
          isRecording
            ? { boxShadow: "0 0 30px rgba(0, 240, 255, 0.3), 0 0 60px rgba(0, 240, 255, 0.1)" }
            : undefined
        }
      >
        {/* Mic icon */}
        <svg
          className={`h-7 w-7 transition-colors ${
            isRecording ? "text-neo" : "text-white/50"
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

      <span className="font-mono text-[10px] tracking-wider text-white/25">
        {isRecording ? "RELEASE TO SEND" : "HOLD TO SPEAK"}
      </span>
    </div>
  );
}
