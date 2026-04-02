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

const VOICE_SYSTEM_PROMPT = [
  "VOICE MODE. Responses are spoken aloud via TTS. The user cannot see text.",
  "",
  "LENGTH: One to two sentences. Maximum 40 words. This is a hard limit. Think walkie-talkie, not essay.",
  "",
  "BANNED: emojis, unicode, dashes, bullets, numbered lists, bold, italic, headers, code blocks, asterisks, backticks, URLs, file paths, code. Any of these is a critical failure.",
  "",
  "STYLE: Plain spoken English. Short. Direct. Spell out numbers. If details needed, say you will send them in text.",
].join("\n");

/** Per-agent localStorage key for thread messages */
function storageKeyForSession(sessionKey: string): string {
  return `crewcmd-chat-${sessionKey.toLowerCase()}`;
}

function getCompanyId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_company=([^;]*)/);
  return match ? match[1] : null;
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

/** Fire-and-forget: persist a single message to the database */
function persistMessage(
  agentId: string,
  role: "user" | "assistant",
  content: string,
) {
  const companyId = getCompanyId();
  if (!companyId || !content) return;

  fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, companyId, role, content }),
  }).catch((err) => {
    console.warn("[chat] Failed to persist message:", err);
  });
}

/** Load message history from DB, returns messages or null if unavailable */
async function loadFromDB(agentId: string): Promise<Message[] | null> {
  const companyId = getCompanyId();
  if (!companyId) return null;

  try {
    // Find the latest session for this agent
    const sessRes = await fetch(
      `/api/chat/sessions?agentId=${encodeURIComponent(agentId)}&companyId=${encodeURIComponent(companyId)}`
    );
    if (!sessRes.ok) return null;

    const { sessions } = await sessRes.json() as {
      sessions: { id: string; agentId: string; title: string | null }[];
    };
    if (!sessions?.length) return null;

    // Load messages from most recent session
    const msgRes = await fetch(
      `/api/chat/messages?sessionId=${encodeURIComponent(sessions[0].id)}&limit=100`
    );
    if (!msgRes.ok) return null;

    const { messages } = await msgRes.json() as {
      messages: { id: string; role: "user" | "assistant"; content: string }[];
    };
    return messages?.length ? messages : null;
  } catch {
    return null;
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
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingStartRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sentence-level TTS queue for agent mode
  const ttsQueueRef = useRef<string[]>([]);
  const isSpeakingQueueRef = useRef(false);
  const spokenSentencesRef = useRef<number>(0);

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

  // Load messages when session changes: DB → localStorage → gateway (waterfall)
  useEffect(() => {
    let cancelled = false;
    const agentId = selectedAgent?.callsign || activeSessionKey;

    async function load() {
      // 1. Instant render from localStorage cache
      const cached = loadMessages(activeSessionKey);
      if (cached.length > 0 && !cancelled) {
        setMessages(cached);
      }

      // 2. Try loading from DB (authoritative source)
      const dbMessages = await loadFromDB(agentId);
      if (cancelled) return;

      if (dbMessages && dbMessages.length > 0) {
        setMessages(dbMessages);
        saveMessages(activeSessionKey, dbMessages); // sync localStorage
        return;
      }

      // 3. If DB empty but localStorage had messages, keep them (may need migration)
      if (cached.length > 0) return;

      // 4. Last resort: fetch from gateway (ephemeral session history)
      try {
        const res = await fetch(
          `/api/chat/history?sessionKey=${encodeURIComponent(activeSessionKey)}&limit=50`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.messages?.length && !cancelled) {
          setMessages(data.messages);
        }
      } catch {
        // Gateway unavailable
      }
    }

    load();

    // Clear unread for this session
    setUnreadCounts((prev) => {
      if (!prev[activeSessionKey]) return prev;
      const next = { ...prev };
      delete next[activeSessionKey];
      return next;
    });

    return () => { cancelled = true; };
  }, [activeSessionKey, selectedAgent?.callsign]);

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

  // Agent mode: speak acknowledgment when thinking starts, check-in after 30s
  const thinkingAcks = useMemo(
    () => [
      "Let me think about that.",
      "Working on it.",
      "Give me a moment.",
      "One second.",
      "On it.",
    ],
    []
  );

  useEffect(() => {
    if (isLoading && voiceMode === "agent") {
      loadingStartRef.current = Date.now();
      // Speak a random thinking ack
      const ack = thinkingAcks[Math.floor(Math.random() * thinkingAcks.length)];
      playTTS(ack);

      // Check-in after 30s if still loading
      thinkingTimerRef.current = setTimeout(() => {
        if (isLoading) {
          playTTS("Still working on this. Hang tight.");
        }
      }, 30000);
    }

    return () => {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
    // playTTS intentionally omitted to avoid re-firing on TTS ref changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, voiceMode, thinkingAcks]);

  // Escape key cancels in-flight chat request
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLoading && abortControllerRef.current) {
        e.preventDefault();
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        // Also stop any TTS
        window.speechSynthesis?.cancel();
        ttsQueueRef.current = [];
        isSpeakingQueueRef.current = false;
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isLoading]);

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

  // Pre-fetch next TTS audio while current sentence plays
  const prefetchedAudioRef = useRef<{ text: string; url: string } | null>(null);

  const prefetchTTS = useCallback(async (text: string) => {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      prefetchedAudioRef.current = { text, url };
    } catch {
      // Prefetch is best-effort
    }
  }, []);

  // Sentence-level TTS: speak each sentence as it completes during streaming
  const speakNextInQueue = useCallback(async () => {
    if (isSpeakingQueueRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) {
      isSpeakingQueueRef.current = false;
      return;
    }
    isSpeakingQueueRef.current = true;
    setIsPlayingAudio(true);

    // Kick off prefetch of the NEXT sentence while this one plays
    const upcoming = ttsQueueRef.current[0];
    if (upcoming && ttsModRef.current !== "browser") {
      prefetchTTS(upcoming);
    }

    try {
      if (ttsModRef.current === "browser") {
        // Browser TTS with queue continuation
        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(next);
          utterance.rate = 1.15;
          utterance.onend = () => {
            isSpeakingQueueRef.current = false;
            if (ttsQueueRef.current.length > 0) {
              speakNextInQueue();
            } else {
              setIsPlayingAudio(false);
            }
          };
          utterance.onerror = () => {
            isSpeakingQueueRef.current = false;
            setIsPlayingAudio(false);
          };
          speechSynthesis.speak(utterance);
        }
        return;
      }

      // Check if we have a prefetched audio for this exact sentence
      let url: string;
      if (prefetchedAudioRef.current?.text === next) {
        url = prefetchedAudioRef.current.url;
        prefetchedAudioRef.current = null;
      } else {
        // Fetch fresh
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: next }),
        });

        if (!response.ok) {
          isSpeakingQueueRef.current = false;
          setIsPlayingAudio(false);
          return;
        }

        const blob = await response.blob();
        url = URL.createObjectURL(blob);
      }

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.playbackRate = 1.15;
        audioRef.current.onended = () => {
          URL.revokeObjectURL(url);
          isSpeakingQueueRef.current = false;
          if (ttsQueueRef.current.length > 0) {
            speakNextInQueue();
          } else {
            setIsPlayingAudio(false);
          }
        };
        audioRef.current.onerror = () => {
          URL.revokeObjectURL(url);
          isSpeakingQueueRef.current = false;
          setIsPlayingAudio(false);
        };
        await audioRef.current.play();
      }
    } catch {
      isSpeakingQueueRef.current = false;
      setIsPlayingAudio(false);
    }
  }, []);

  /** Queue a sentence for TTS and start speaking if idle */
  const queueSentenceForTTS = useCallback(
    (sentence: string) => {
      const cleaned = sentence.trim();
      if (!cleaned) return;
      ttsQueueRef.current.push(cleaned);
      if (!isSpeakingQueueRef.current) {
        speakNextInQueue();
      }
    },
    [speakNextInQueue]
  );

  // Patterns that indicate the user is checking if we heard them
  const busyPatterns = /\b(did you hear|are you there|hello|hey|still there|you there|can you hear|listening)\b/i;

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Agent mode: if loading and user speaks, give a reassurance instead of blocking
      if (isLoading && voiceMode === "agent") {
        if (busyPatterns.test(trimmed)) {
          playTTS("Yes, I heard you. Still working on my response.");
        } else {
          playTTS("I am still thinking about your last message. Give me a moment.");
        }
        return;
      }
      if (isLoading) return;

      // Send to OpenClaw Gateway
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      persistMessage(agentCallsign, "user", trimmed);
      setInput("");
      setIsLoading(true);
      setStreamingContent("");
      let fullContent = "";

      const chatMessages = [
        ...(speakResponses
          ? [{ role: "system" as const, content: VOICE_SYSTEM_PROMPT }]
          : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: trimmed },
      ];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: chatMessages,
            agent: selectedAgent?.callsign,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        fullContent = "";
        // Track unspoken buffer for sentence-level TTS
        let unspokenBuffer = "";
        spokenSentencesRef.current = 0;
        ttsQueueRef.current = [];
        isSpeakingQueueRef.current = false;

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

                // Sentence-level TTS: extract complete sentences and queue them
                if (speakResponses) {
                  unspokenBuffer += delta;
                  // Split on sentence boundaries (. ! ?) followed by space or end
                  const sentenceMatch = unspokenBuffer.match(/^([\s\S]*?[.!?])\s+([\s\S]*)/);
                  if (sentenceMatch) {
                    const completeSentence = sentenceMatch[1];
                    unspokenBuffer = sentenceMatch[2];
                    queueSentenceForTTS(completeSentence);
                    spokenSentencesRef.current++;
                  }
                }
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }

        // Queue any remaining unspoken text
        if (speakResponses && unspokenBuffer.trim()) {
          queueSentenceForTTS(unspokenBuffer.trim());
        }

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent || "No response received.",
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (fullContent) {
          persistMessage(agentCallsign, "assistant", fullContent);
        }
        setStreamingContent("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // User cancelled with Escape — keep any partial content as the message
          if (fullContent) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullContent + "\n\n_(cancelled)_",
              },
            ]);
          }
          setStreamingContent("");
        } else {
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
      }

      abortControllerRef.current = null;
      setIsLoading(false);
    },
    [isLoading, voiceMode, messages, playTTS, queueSentenceForTTS, selectedAgent, speakResponses]
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
            <div>
              <ChatMessage
                role="assistant"
                content={streamingContent}
                isStreaming={true}
              />
              <button
                onClick={() => abortControllerRef.current?.abort()}
                className="ml-11 mt-1 flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-secondary)]"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="2" />
                </svg>
                Stop
              </button>
            </div>
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
              <span className="ml-2 self-center text-[11px] text-[var(--text-tertiary)] opacity-60">
                Esc to cancel
              </span>
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

          {/* Messages — only show completed messages in agent mode (no streaming text, user is hands-free) */}
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
              ))}
              {isLoading && (
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
