"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/chat/chat-message";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { WaveformVisualizer } from "@/components/chat/waveform-visualizer";
import type { Agent } from "@/lib/data";

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

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Fetch agents on mount
  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch("/api/agents");
        const data = await res.json();
        const fetched: Agent[] = Array.isArray(data) ? data : data.agents || [];
        setAgents(fetched);
        if (fetched.length > 0) {
          setSelectedAgent(fetched[0]);
        }
      } catch {
        // Agents unavailable — leave empty
      }
    }
    fetchAgents();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        title: selectedAgent?.callsign || "Crew Chat",
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
  }, [selectedAgent]);

  const agentCallsign = selectedAgent?.callsign || "MAIN";
  const agentEmoji = selectedAgent?.emoji || "💬";
  const agentColor = selectedAgent?.color || "#00f0ff";
  const agentAbbrev = agentCallsign.slice(0, 3).toUpperCase();

  const statusColor = (status: string) => {
    switch (status) {
      case "online":
      case "working":
        return "bg-green-400";
      case "idle":
        return "bg-yellow-400";
      default:
        return "bg-zinc-500";
    }
  };

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
          body: JSON.stringify({
            messages: chatMessages,
            agent: selectedAgent?.callsign,
          }),
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
    [isLoading, messages, voiceMode, chatMode, playTTS, selectedAgent]
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
      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/50 backdrop-blur-xl px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: agentColor,
                boxShadow: `0 0 10px ${agentColor}80`,
              }}
            />
            {/* Agent selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-mono font-bold tracking-wider transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)]"
                style={{ color: agentColor }}
              >
                <span>{agentEmoji}</span>
                <span>{agentCallsign}</span>
                <svg
                  className={`h-3 w-3 transition-transform ${agentDropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {agentDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] py-1 shadow-xl backdrop-blur-xl">
                  {agents.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
                      No agents available
                    </div>
                  ) : (
                    agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          setSelectedAgent(agent);
                          setAgentDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--bg-surface-hover)] ${
                          selectedAgent?.id === agent.id
                            ? "bg-[var(--bg-surface-hover)]"
                            : ""
                        }`}
                      >
                        <span className="text-base">{agent.emoji}</span>
                        <div className="flex flex-1 items-center gap-2 overflow-hidden">
                          <span
                            className="font-mono font-bold tracking-wider"
                            style={{ color: agent.color }}
                          >
                            {agent.callsign}
                          </span>
                          <span className="truncate text-[var(--text-tertiary)]">
                            {agent.name}
                          </span>
                        </div>
                        <div
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(agent.status)}`}
                        />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode toggle: Talk / Create Task */}
            <div className="flex rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-0.5">
              <button
                onClick={() => setChatMode("talk")}
                className={`rounded-md px-3 py-1.5 text-[10px] tracking-wider transition-all ${
                  chatMode === "talk"
                    ? "bg-neo/15 text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                TALK TO {agentCallsign}
              </button>
              <button
                onClick={() => setChatMode("task")}
                className={`rounded-md px-3 py-1.5 text-[10px] tracking-wider transition-all ${
                  chatMode === "task"
                    ? "bg-neo/15 text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                CREATE TASK
              </button>
            </div>

            {/* Voice mode toggle: OFF / PUSH / AGENT */}
            <div className="flex rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-0.5">
              <button
                onClick={() => setVoiceMode("off")}
                className={`rounded-md px-2.5 py-1.5 text-[10px] tracking-wider transition-all ${
                  voiceMode === "off"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-tertiary)]"
                }`}
              >
                TEXT
              </button>
              <button
                onClick={() => setVoiceMode("push")}
                className={`rounded-md px-2.5 py-1.5 text-[10px] tracking-wider transition-all ${
                  voiceMode === "push"
                    ? "bg-neo/15 text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-tertiary)]"
                }`}
              >
                PUSH
              </button>
              <button
                onClick={() => setVoiceMode("agent")}
                className={`rounded-md px-2.5 py-1.5 text-[10px] tracking-wider transition-all ${
                  voiceMode === "agent"
                    ? "bg-violet-500/15 text-violet-400"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-tertiary)]"
                }`}
              >
                AGENT
              </button>
            </div>

            {/* Clear chat */}
            <button
              onClick={clearChat}
              className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all hover:border-[var(--border-medium)] hover:text-[var(--text-tertiary)]"
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
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: `${agentColor}33`,
                  backgroundColor: `${agentColor}15`,
                  boxShadow: `0 0 30px ${agentColor}26`,
                }}
              >
                <span className="text-xl">{agentEmoji}</span>
              </div>
              <h2
                className="mb-2 font-mono text-lg tracking-wider"
                style={{ color: agentColor }}
              >
                {chatMode === "talk" ? `TALK TO ${agentCallsign}` : "CREATE A TASK"}
              </h2>
              <p className="max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {chatMode === "talk"
                  ? `Start a conversation with ${selectedAgent?.name || agentCallsign} via the OpenClaw Gateway. Your messages are stored locally in this browser.`
                  : "Describe a task and it will be created in the task board automatically."}
              </p>
              {voiceMode === "push" && (
                <p className="mt-2 text-[11px]" style={{ color: `${agentColor}80` }}>
                  Voice mode active - hold the mic button to speak
                </p>
              )}
              {voiceMode === "agent" && (
                <p className="mt-2 text-[11px] text-violet-400/50">
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
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-mono"
                style={{
                  borderColor: `${agentColor}40`,
                  backgroundColor: `${agentColor}15`,
                  color: agentColor,
                }}
              >
                {agentAbbrev}
              </div>
              <div
                className="flex items-center gap-1.5 rounded-xl border px-4 py-3"
                style={{
                  borderColor: `${agentColor}1a`,
                  backgroundColor: `${agentColor}0f`,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ backgroundColor: `${agentColor}80` }}
                />
                <span
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{
                    backgroundColor: `${agentColor}80`,
                    animationDelay: "0.15s",
                  }}
                />
                <span
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{
                    backgroundColor: `${agentColor}80`,
                    animationDelay: "0.3s",
                  }}
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
      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/50 backdrop-blur-xl px-4 py-3 lg:px-6">
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
                    className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-4 py-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-neo/30 focus:bg-[var(--bg-surface-hover)] disabled:opacity-40"
                  />
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={isLoading || !input.trim()}
                    className="rounded-lg border border-neo/20 bg-[var(--accent-soft)] px-4 py-2 text-[11px] tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-soft)] disabled:opacity-30 disabled:cursor-not-allowed"
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
                    : "Message your crew..."
                }
                disabled={isLoading}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-4 py-3 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-neo/30 focus:bg-[var(--bg-surface-hover)] disabled:opacity-40"
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
                className="self-end rounded-lg border border-neo/20 bg-[var(--accent-soft)] px-4 py-3 text-[11px] tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-soft)] disabled:opacity-30 disabled:cursor-not-allowed"
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
