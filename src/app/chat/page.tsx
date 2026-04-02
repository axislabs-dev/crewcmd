"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChatMessage } from "@/components/chat/chat-message";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { WaveformVisualizer } from "@/components/chat/waveform-visualizer";
import {
  AgentTreeSelector,
  findDefaultAgent,
  findParentAgent,
} from "@/components/chat/agent-tree-selector";
import type { Agent } from "@/lib/data";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type VoiceMode = "off" | "agent";

const VOICE_SYSTEM_PROMPT =
  "Voice mode: respond in 1-3 short sentences. Be conversational and concise. No markdown, no bullet points, no code blocks.";

/** Per-agent localStorage key for thread messages */
function storageKeyForSession(sessionKey: string): string {
  return `crewcmd-chat-${sessionKey.toLowerCase()}`;
}

function loadMessages(sessionKey: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(storageKeyForSession(sessionKey));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(sessionKey: string, messages: Message[]) {
  try {
    if (messages.length > 0) {
      localStorage.setItem(
        storageKeyForSession(sessionKey),
        JSON.stringify(messages)
      );
    } else {
      localStorage.removeItem(storageKeyForSession(sessionKey));
    }
  } catch {
    // localStorage unavailable
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [speakResponses, setSpeakResponses] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Derive session key from selected agent
  const activeSessionKey = useMemo(
    () => selectedAgent?.callsign.toLowerCase() || "main",
    [selectedAgent]
  );

  // Fetch agents on mount
  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch("/api/agents");
        const data = await res.json();
        const fetched: Agent[] = Array.isArray(data)
          ? data
          : data.agents || [];
        setAgents(fetched);
        // Default to team lead (top-level agent)
        const defaultAgent = findDefaultAgent(fetched);
        if (defaultAgent) {
          setSelectedAgent(defaultAgent);
        }
      } catch {
        // Agents unavailable
      }
    }
    fetchAgents();
  }, []);

  // Load messages when session changes
  useEffect(() => {
    setMessages(loadMessages(activeSessionKey));
    // Clear unread for this session
    setUnreadCounts((prev) => {
      if (!prev[activeSessionKey]) return prev;
      const next = { ...prev };
      delete next[activeSessionKey];
      return next;
    });
  }, [activeSessionKey]);

  // Save messages when they change
  useEffect(() => {
    saveMessages(activeSessionKey, messages);
  }, [messages, activeSessionKey]);

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

  // Find parent agent for header display
  const parentAgent = useMemo(
    () => (selectedAgent ? findParentAgent(selectedAgent, agents) : null),
    [selectedAgent, agents]
  );

  const handleAgentSelect = useCallback(
    (agent: Agent) => {
      if (agent.id === selectedAgent?.id) return;
      // Save current messages before switching
      saveMessages(activeSessionKey, messages);
      setStreamingContent("");
      setSelectedAgent(agent);
    },
    [selectedAgent, activeSessionKey, messages]
  );

  const ttsModRef = useRef<"server" | "browser" | "unknown">("unknown");

  // Probe TTS availability on mount
  useEffect(() => {
    fetch("/api/tts")
      .then((res) => {
        ttsModRef.current = res.ok ? "server" : "browser";
      })
      .catch(() => {
        ttsModRef.current = "browser";
      });
  }, []);

  const playBrowserTTS = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      setIsPlayingAudio(false);
      return;
    }

    // Cancel any in-progress speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Try to pick a decent voice (prefer English, non-robotic)
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Daniel") || v.name.includes("Google") || v.name.includes("Neural"))
    ) || voices.find((v) => v.lang.startsWith("en") && v.localService);
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    window.speechSynthesis.speak(utterance);
  }, []);

  const playTTS = useCallback(async (text: string) => {
    try {
      setIsPlayingAudio(true);

      // If we already know server TTS is unavailable, go straight to browser
      if (ttsModRef.current === "browser") {
        playBrowserTTS(text);
        return;
      }

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (response.status === 503) {
        // Server has no TTS backend, switch to browser mode
        console.log("[TTS] Server unavailable, using browser speechSynthesis");
        ttsModRef.current = "browser";
        playBrowserTTS(text);
        return;
      }

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
      // Network error — try browser fallback
      playBrowserTTS(text);
    }
  }, [playBrowserTTS]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // Send to OpenClaw Gateway
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
        ...(speakResponses
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

        if (speakResponses && fullContent) {
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
    [isLoading, messages, playTTS, selectedAgent, speakResponses]
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
    localStorage.removeItem(storageKeyForSession(activeSessionKey));
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh flex-col">
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

            {/* Hierarchy-aware agent tree selector */}
            <AgentTreeSelector
              agents={agents}
              selectedAgent={selectedAgent}
              onSelect={handleAgentSelect}
              unreadCounts={unreadCounts}
            />

            {/* Thread context: agent info + reporting chain */}
            {selectedAgent && (
              <div className="hidden sm:flex flex-col ml-2">
                <span className="text-[11px] text-[var(--text-secondary)] font-medium">
                  {selectedAgent.title || selectedAgent.name}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {parentAgent ? (
                    <>
                      Reports to: {parentAgent.emoji} {parentAgent.callsign}
                    </>
                  ) : (
                    "Team Lead"
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Clear chat */}
            <button
              onClick={clearChat}
              className="hidden sm:block rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all hover:border-[var(--border-medium)] hover:text-[var(--text-tertiary)]"
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
                {agentCallsign}
              </h2>
              <p className="max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {`Start a conversation with ${selectedAgent?.name || agentCallsign} via the OpenClaw Gateway.${
                  parentAgent
                    ? ` This is ${agentCallsign}'s thread — ${parentAgent.emoji} ${parentAgent.callsign} monitors it.`
                    : ""
                }`}
              </p>

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

      {/* Agent mode fullscreen overlay */}
      {voiceMode === "agent" && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]">
          {/* Agent overlay header */}
          <div className="flex items-center justify-between px-4 py-3 lg:px-6">
            <div className="flex items-center gap-2">
              <span className="text-lg">{agentEmoji}</span>
              <span className="text-[12px] font-medium tracking-wider" style={{ color: agentColor }}>
                {agentCallsign}
              </span>
            </div>
            <button
              onClick={() => setVoiceMode("off")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all hover:text-[var(--text-secondary)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              EXIT
            </button>
          </div>

          {/* Scrollable messages behind the viz */}
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
              ))}
              {streamingContent && (
                <ChatMessage role="assistant" content={streamingContent} isStreaming={true} />
              )}
              {isLoading && !streamingContent && (
                <div className="flex justify-center py-4">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `${agentColor}80` }} />
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `${agentColor}80`, animationDelay: "0.15s" }} />
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `${agentColor}80`, animationDelay: "0.3s" }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Agent VAD interface at bottom */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/80 backdrop-blur-xl px-4 py-4 lg:px-6">
            <VoiceAgent
              onTranscript={sendMessage}
              isPlayingAudio={isPlayingAudio}
              onInterrupt={interruptAudio}
              isLoading={isLoading}
            />
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/50 backdrop-blur-xl px-2 py-3 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-1.5 sm:gap-2">
            {/* Mute/unmute toggle — hidden on small screens */}
            <button
              onClick={() => setSpeakResponses(!speakResponses)}
              title={speakResponses ? "Mute responses" : "Speak responses"}
              className={`hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all ${
                speakResponses
                  ? "border-neo/30 bg-neo/15 text-[var(--accent)]"
                  : "border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {speakResponses ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              )}
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                `Message ${agentCallsign}...`
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
            <VoiceRecorder
              onTranscript={sendMessage}
              isDisabled={isLoading}
            />

            {/* Agent mode button — hidden on small screens */}
            <button
              onClick={() => { setVoiceMode("agent"); setSpeakResponses(true); }}
              title="Enter agent mode (hands-free)"
              className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400 transition-all hover:bg-violet-500/20 hover:border-violet-500/30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </button>

            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className="shrink-0 rounded-lg border border-neo/20 bg-[var(--accent-soft)] px-3 py-3 sm:px-4 text-[11px] tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-soft)] disabled:opacity-30 disabled:cursor-not-allowed"
              style={
                !isLoading && input.trim()
                  ? { boxShadow: "0 0 15px rgba(0, 240, 255, 0.15)" }
                  : undefined
              }
            >
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
