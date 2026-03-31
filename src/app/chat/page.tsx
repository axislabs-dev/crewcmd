"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/chat/chat-message";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { WaveformVisualizer } from "@/components/chat/waveform-visualizer";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type ChatMode = "talk" | "task";
type VoiceMode = "off" | "push" | "agent";

const STORAGE_KEY = "neo-chat-messages";
const VOICE_SYSTEM_PROMPT =
  "Voice mode: respond in 1-3 short sentences. Be conversational and concise. No markdown, no bullet points, no code blocks.";

function loadMessages(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: Message[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {}
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("talk");
  const [streamingContent, setStreamingContent] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  // Save messages when they change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Media Session API for background audio
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Neo",
        artist: "CrewCmd",
        album: "CrewCmd",
      });
      navigator.mediaSession.setActionHandler("play", () => {
        audioRef.current?.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
      });
    }
  }, []);

  const playTTS = useCallback(async (text: string) => {
    try {
      setIsPlayingAudio(true);
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        console.error("[TTS] Error:", response.status);
        setIsPlayingAudio(false);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => {
          setIsPlayingAudio(false);
          URL.revokeObjectURL(url);
        };
        audioRef.current.onerror = () => {
          setIsPlayingAudio(false);
          URL.revokeObjectURL(url);
        };
        await audioRef.current.play();
      }
    } catch (error) {
      console.error("[TTS] Error:", error);
      setIsPlayingAudio(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // Task mode: create a task instead
      if (chatMode === "task") {
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setIsLoading(true);

        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: trimmed,
              source: "manual",
              status: "inbox",
            }),
          });
          const task = await res.json();
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: res.ok
              ? `Task created: **TSK-${task.shortId}** - "${task.title}" (${task.status})`
              : `Failed to create task: ${task.error || "Unknown error"}`,
          };
          setMessages((prev) => [...prev, assistantMsg]);
          if (voiceMode !== "off" && res.ok) {
            playTTS(`Task created: TSK-${task.shortId}, ${task.title}`);
          }
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Failed to create task. Please try again.",
            },
          ]);
        }
        setIsLoading(false);
        return;
      }

      // Chat mode: send to OpenClaw Gateway
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);
      setStreamingContent("");

      const chatMessages = [
        ...(voiceMode !== "off"
          ? [{ role: "system" as const, content: VOICE_SYSTEM_PROMPT }]
          : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: trimmed },
      ];

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chatMessages }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                setStreamingContent(fullContent);
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent || "No response received.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");

        if (voiceMode !== "off" && fullContent) {
          playTTS(fullContent);
        }
      } catch (error) {
        console.error("[Chat] Error:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Connection error. Make sure the OpenClaw Gateway is reachable.",
          },
        ]);
        setStreamingContent("");
      }

      setIsLoading(false);
    },
    [isLoading, messages, voiceMode, chatMode, playTTS]
  );

  const interruptAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingAudio(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} className="hidden" />

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-bg-primary/50 backdrop-blur-xl px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-2.5 w-2.5 rounded-full bg-neo"
              style={{ boxShadow: "0 0 10px rgba(0, 240, 255, 0.5)" }}
            />
            <h1 className="glow-text-neo font-mono text-sm font-bold tracking-wider text-neo">
              NEO CHAT
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode toggle: Talk / Create Task */}
            <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              <button
                onClick={() => setChatMode("talk")}
                className={`rounded-md px-3 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
                  chatMode === "talk"
                    ? "bg-neo/15 text-neo"
                    : "text-white/35 hover:text-white/50"
                }`}
              >
                TALK TO NEO
              </button>
              <button
                onClick={() => setChatMode("task")}
                className={`rounded-md px-3 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
                  chatMode === "task"
                    ? "bg-neo/15 text-neo"
                    : "text-white/35 hover:text-white/50"
                }`}
              >
                CREATE TASK
              </button>
            </div>

            {/* Voice mode toggle: OFF / PUSH / AGENT */}
            <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              <button
                onClick={() => setVoiceMode("off")}
                className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
                  voiceMode === "off"
                    ? "bg-white/10 text-white/60"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                TEXT
              </button>
              <button
                onClick={() => setVoiceMode("push")}
                className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
                  voiceMode === "push"
                    ? "bg-neo/15 text-neo"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                PUSH
              </button>
              <button
                onClick={() => setVoiceMode("agent")}
                className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
                  voiceMode === "agent"
                    ? "bg-violet-500/15 text-violet-400"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                AGENT
              </button>
            </div>

            {/* Clear chat */}
            <button
              onClick={clearChat}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] tracking-wider text-white/25 transition-all hover:border-white/15 hover:text-white/40"
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-neo/20 bg-neo/10"
                style={{
                  boxShadow: "0 0 30px rgba(0, 240, 255, 0.15)",
                }}
              >
                <span className="font-mono text-xl text-neo">N</span>
              </div>
              <h2 className="glow-text-neo mb-2 font-mono text-lg tracking-wider text-neo">
                {chatMode === "talk" ? "TALK TO NEO" : "CREATE A TASK"}
              </h2>
              <p className="max-w-md font-mono text-[12px] leading-relaxed text-white/30">
                {chatMode === "talk"
                  ? "Start a conversation with Neo via the OpenClaw Gateway. Your messages are stored locally in this browser."
                  : "Describe a task and it will be created in the task board automatically."}
              </p>
              {voiceMode === "push" && (
                <p className="mt-2 font-mono text-[11px] text-neo/50">
                  Voice mode active - hold the mic button to speak
                </p>
              )}
              {voiceMode === "agent" && (
                <p className="mt-2 font-mono text-[11px] text-violet-400/50">
                  Agent mode - activate and speak naturally
                </p>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
          ))}

          {/* Streaming message */}
          {streamingContent && (
            <ChatMessage
              role="assistant"
              content={streamingContent}
              isStreaming={true}
            />
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div className="flex gap-3 animate-fade-in">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neo/20 bg-neo/10 text-xs font-mono text-neo">
                NEO
              </div>
              <div className="flex items-center gap-1.5 rounded-xl border border-neo/10 bg-neo/[0.06] px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-neo/50 animate-pulse" />
                <span
                  className="h-2 w-2 rounded-full bg-neo/50 animate-pulse"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="h-2 w-2 rounded-full bg-neo/50 animate-pulse"
                  style={{ animationDelay: "0.3s" }}
                />
              </div>
            </div>
          )}

          {/* Waveform when playing audio */}
          {isPlayingAudio && (
            <div className="flex justify-center py-2">
              <WaveformVisualizer isActive={isPlayingAudio} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-white/[0.06] bg-bg-primary/50 backdrop-blur-xl px-4 py-3 lg:px-6">
        <div className="mx-auto max-w-3xl">
          {voiceMode === "agent" ? (
            <VoiceAgent
              onTranscript={sendMessage}
              isPlayingAudio={isPlayingAudio}
              onInterrupt={interruptAudio}
              isLoading={isLoading}
            />
          ) : voiceMode === "push" ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <VoiceRecorder
                onTranscript={sendMessage}
                isDisabled={isLoading}
              />
              {/* Fallback text input in voice mode */}
              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        sendMessage(input);
                      }
                    }}
                    placeholder={
                      chatMode === "task"
                        ? "Or type a task..."
                        : "Or type a message..."
                    }
                    disabled={isLoading}
                    className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2 font-mono text-[12px] text-white/70 placeholder-white/20 outline-none transition-colors focus:border-neo/30 focus:bg-white/[0.05] disabled:opacity-40"
                  />
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={isLoading || !input.trim()}
                    className="rounded-lg border border-neo/20 bg-neo/10 px-4 py-2 font-mono text-[11px] tracking-wider text-neo transition-all hover:bg-neo/20 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    SEND
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  chatMode === "task"
                    ? "Describe a task to create..."
                    : "Message Neo..."
                }
                disabled={isLoading}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-mono text-[13px] text-white/70 placeholder-white/20 outline-none transition-colors focus:border-neo/30 focus:bg-white/[0.05] disabled:opacity-40"
                style={{ maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="self-end rounded-lg border border-neo/20 bg-neo/10 px-4 py-3 font-mono text-[11px] tracking-wider text-neo transition-all hover:bg-neo/20 disabled:opacity-30 disabled:cursor-not-allowed"
                style={
                  !isLoading && input.trim()
                    ? { boxShadow: "0 0 15px rgba(0, 240, 255, 0.15)" }
                    : undefined
                }
              >
                {chatMode === "task" ? "CREATE" : "SEND"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
