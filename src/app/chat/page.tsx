"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChatMessage, DateSeparator, getDateKey } from "@/components/chat/chat-message";
import type { Attachment } from "@/components/chat/chat-message";
import { VoiceRecorder } from "@/components/chat/voice-recorder";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { WaveformVisualizer } from "@/components/chat/waveform-visualizer";
import {
  AgentTreeSelector,
  findDefaultAgent,
  findParentAgent,
} from "@/components/chat/agent-tree-selector";
import type { Agent } from "@/lib/data";
import { parseTaskReferences } from "@/lib/parse-task-references";
import { useChatStore } from "@/lib/chat-store";
import { useCompany } from "@/components/company-context";

/** Append <!--task_card --> markers for parsed task references not already embedded. */
function injectTaskCardMarkers(content: string, refs: ReturnType<typeof parseTaskReferences>): string {
  if (refs.length === 0) return content;
  // Don't re-inject if markers already present
  if (content.includes("<!--task_card")) return content;

  const markers = refs.map((ref) => {
    const data: Record<string, unknown> = {};
    if (ref.taskId) data.id = ref.taskId;
    if (ref.shortId) data.shortId = ref.shortId;
    if (ref.title) data.title = ref.title;
    if (ref.status) data.status = ref.status;
    data.priority = "medium";
    // Only include if we have enough to render
    if (!data.id && !data.title) return "";
    return `<!--task_card ${JSON.stringify(data)} -->`;
  }).filter(Boolean);

  if (markers.length === 0) return content;
  return content + "\n\n" + markers.join("\n");
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  metadata?: { attachments?: Attachment[] } | null;
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

/** Load message history from DB into the Zustand store for an agent */
async function loadFromDBIntoStore(agentId: string, companyId: string) {
  try {
    const sessRes = await fetch(
      `/api/chat/sessions?agentId=${encodeURIComponent(agentId)}&companyId=${encodeURIComponent(companyId)}`
    );
    if (!sessRes.ok) return;

    const { sessions } = await sessRes.json() as {
      sessions: { id: string; agentId: string; title: string | null }[];
    };
    if (!sessions?.length) return;

    const allMessages: { id: string; sessionId: string; role: "user" | "assistant"; content: string; createdAt?: string; metadata?: Message["metadata"] }[] = [];
    for (const session of sessions) {
      const msgRes = await fetch(
        `/api/chat/messages?sessionId=${encodeURIComponent(session.id)}&limit=100`
      );
      if (!msgRes.ok) continue;
      const { messages } = await msgRes.json() as {
        messages: { id: string; role: "user" | "assistant"; content: string; createdAt?: string; metadata?: Message["metadata"] }[];
      };
      if (messages?.length) {
        allMessages.push(...messages.map((m) => ({ ...m, sessionId: session.id })));
      }
    }

    if (!allMessages.length) return;

    useChatStore.getState().loadSession(
      agentId,
      allMessages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        agentId: agentId.toLowerCase(),
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt || new Date().toISOString(),
      }))
    );
  } catch {
    // DB unavailable
  }
}

export default function ChatPage() {
  const { company } = useCompany();
  const storeMarkRead = useChatStore((s) => s.markRead);
  const storeClearAgent = useChatStore((s) => s.clearAgent);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("off");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [speakResponses, setSpeakResponses] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const unreadCounts = useChatStore((s) => s.unreadByAgent);
  const [isPaused, setIsPaused] = useState(false);
  const [stopWords, setStopWords] = useState<string[]>([
    "stop", "pause", "shut up", "be quiet", "hold on", "wait", "enough", "stop talking",
  ]);

  const [showScrollButton, setShowScrollButton] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const agentScrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingStartRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Track in-flight streaming so we can persist on unmount (navigation away)
  const streamingContentRef = useRef("");
  const streamingAgentRef = useRef<string | null>(null);

  // Sentence-level TTS queue for agent mode
  const ttsQueueRef = useRef<string[]>([]);
  const isSpeakingQueueRef = useRef(false);
  const spokenSentencesRef = useRef<number>(0);

  // Derive session key from selected agent
  const activeSessionKey = useMemo(
    () => selectedAgent?.callsign.toLowerCase() || "main",
    [selectedAgent]
  );

  // No unmount persistence needed — server-side /api/chat route persists
  // partial content on client disconnect via the cancel handler.

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

  // Load configurable stop words from system settings
  useEffect(() => {
    fetch("/api/system-settings?key=chat.stopWords")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.value) {
          try {
            const parsed = JSON.parse(data.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setStopWords(parsed);
            }
          } catch {
            // Keep defaults
          }
        }
      })
      .catch(() => {
        // Keep defaults
      });
  }, []);

  // Load messages from Zustand store; on first load for an agent, hydrate from DB
  const loadedAgentsRef = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const agentId = selectedAgent?.callsign || activeSessionKey;
    const companyId = company?.id;

    // Read whatever the store already has (from SSE)
    const storeMessages = useChatStore.getState().messagesByAgent[activeSessionKey.toLowerCase()] || [];
    if (storeMessages.length > 0 && !cancelled) {
      setMessages(storeMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata,
      })));
    } else {
      setMessages([]);
    }

    // If we haven't loaded from DB for this agent yet, do so
    if (companyId && !loadedAgentsRef.current.has(activeSessionKey.toLowerCase())) {
      loadedAgentsRef.current.add(activeSessionKey.toLowerCase());
      loadFromDBIntoStore(agentId, companyId).then(() => {
        if (cancelled) return;
        const updated = useChatStore.getState().messagesByAgent[activeSessionKey.toLowerCase()] || [];
        setMessages(updated.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
          metadata: m.metadata,
        })));
      });
    }

    // Mark as read
    storeMarkRead(activeSessionKey);

    return () => { cancelled = true; };
  }, [activeSessionKey, selectedAgent?.callsign, company?.id, storeMarkRead]);

  // Sync store → local messages when store changes (new messages from SSE)
  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      const storeMessages = state.messagesByAgent[activeSessionKey.toLowerCase()] || [];
      setMessages((prev) => {
        // Only update if store has messages we don't have
        if (storeMessages.length <= prev.length) {
          // Check if the last message IDs match — if so, no update needed
          const lastStore = storeMessages[storeMessages.length - 1];
          const lastLocal = prev[prev.length - 1];
          if (lastStore?.id === lastLocal?.id) return prev;
        }

        // Merge: keep local optimistic messages, add store messages, deduplicate
        const storeIds = new Set(storeMessages.map((m) => m.id));
        const optimistic = prev.filter((m) => !storeIds.has(m.id) && m.id.startsWith("optimistic-"));
        const merged = [
          ...storeMessages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt,
            metadata: m.metadata,
          })),
          ...optimistic,
        ].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

        return merged;
      });
    });
    return unsub;
  }, [activeSessionKey]);

  // Check if user is near bottom of scroll container
  const isNearBottom = useCallback(() => {
    const el = agentScrollContainerRef.current ?? scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Track whether user was at bottom before new content arrives
  const wasAtBottomRef = useRef(true);

  // Update wasAtBottom on scroll events (before React re-renders with new messages)
  useEffect(() => {
    const els = [scrollContainerRef.current, agentScrollContainerRef.current].filter(Boolean) as HTMLDivElement[];
    if (els.length === 0) return;
    const trackPosition = () => {
      wasAtBottomRef.current = isNearBottom();
    };
    els.forEach((el) => el.addEventListener("scroll", trackPosition, { passive: true }));
    return () => els.forEach((el) => el.removeEventListener("scroll", trackPosition));
  }, [isNearBottom, voiceMode]);

  // Auto-scroll to bottom when new content arrives (if user was already at bottom)
  useEffect(() => {
    if (wasAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

  // Track scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    const els = [scrollContainerRef.current, agentScrollContainerRef.current].filter(Boolean) as HTMLDivElement[];
    if (els.length === 0) return;
    const handleScroll = () => {
      setShowScrollButton(!isNearBottom());
    };
    els.forEach((el) => el.addEventListener("scroll", handleScroll, { passive: true }));
    return () => els.forEach((el) => el.removeEventListener("scroll", handleScroll));
  }, [isNearBottom, voiceMode]);

  // Scroll to bottom on initial load / session switch / navigate back
  useEffect(() => {
    // Double rAF ensures DOM has rendered messages before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView();
      });
    });
  }, [activeSessionKey]);

  // Also scroll to bottom when messages first load (handles page reload + navigate back)
  const prevMessageCount = useRef(0);
  useEffect(() => {
    if (messages.length > 0 && prevMessageCount.current === 0) {
      // First batch of messages loaded — scroll to bottom
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView();
        });
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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
      // Abort any in-flight streaming to prevent cross-agent bleed
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsLoading(false);
      setStreamingContent("");
      // Clear messages immediately so previous agent's thread doesn't bleed
      setMessages([]);
      setSelectedAgent(agent);
    },
    [selectedAgent]
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
        stopAllAudio();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isLoading]);

  // Stop all audio playback (server TTS, browser TTS, queued sentences)
  const stopAllAudio = useCallback(() => {
    window.speechSynthesis?.cancel();
    ttsQueueRef.current = [];
    isSpeakingQueueRef.current = false;
    prefetchedAudioRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
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
      } else {
        console.error("[TTS Queue] No audioRef.current available");
        isSpeakingQueueRef.current = false;
        setIsPlayingAudio(false);
      }
    } catch (err) {
      console.error("[TTS Queue] Playback error:", err);
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

  const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv";

  const addFiles = useCallback((files: FileList | File[]) => {
    const allowed = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type) && f.size <= 10 * 1024 * 1024);
    if (allowed.length) setPendingFiles((prev) => [...prev, ...allowed]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Upload a single file and return attachment metadata */
  async function uploadFile(file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const hasFiles = pendingFiles.length > 0;
      if (!trimmed && !hasFiles) return;

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

      // --- Wake word detection: check if user is addressing a specific agent ---
      const lowerTrimmed = trimmed.toLowerCase();
      let wakeAgent: Agent | null = null;
      for (const agent of agents) {
        const callsign = agent.callsign.toLowerCase();
        const name = agent.name.toLowerCase();
        // Match patterns: @callsign, "callsign," , "callsign " at start, "hey callsign", "hey name"
        const patterns = [
          new RegExp(`^@${callsign}\\b`, "i"),
          new RegExp(`^@${name}\\b`, "i"),
          new RegExp(`^${callsign}[,:\\s]`, "i"),
          new RegExp(`^${name}[,:\\s]`, "i"),
          new RegExp(`^hey\\s+${callsign}\\b`, "i"),
          new RegExp(`^hey\\s+${name}\\b`, "i"),
          new RegExp(`\\b@${callsign}\\b`, "i"),
          new RegExp(`\\b@${name}\\b`, "i"),
        ];
        if (patterns.some((p) => p.test(trimmed))) {
          wakeAgent = agent;
          break;
        }
      }

      // If wake word detected, switch agent and/or unpause
      if (wakeAgent) {
        if (wakeAgent.id !== selectedAgent?.id) {
          setStreamingContent("");
          setSelectedAgent(wakeAgent);
        }
        if (isPaused) {
          setIsPaused(false);
        }
        // Don't return — continue sending the message to the (now-active) agent
      }

      // --- Stop word detection: check if entire message is a stop phrase ---
      if (!wakeAgent && stopWords.some((sw) => lowerTrimmed === sw.toLowerCase())) {
        // Show user message in chat
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");

        // Show system-style pause message
        const pauseMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Agent paused. Type a message or say their name to resume.",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, pauseMsg]);
        setIsPaused(true);
        return;
      }

      // --- Paused state: show message locally but don't forward to gateway ---
      if (isPaused && !wakeAgent) {
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
          metadata: pendingFiles.length > 0 ? { attachments: [] } : null,
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        // Server will persist via /api/chat — no client-side persistMessage needed
        return;
      }

      // Slash command: /task <title>
      if (trimmed.startsWith("/task ")) {
        const taskTitle = trimmed.slice(6).trim();
        if (!taskTitle) return;

        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        wasAtBottomRef.current = true;
        setInput("");
        setIsLoading(true);

        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: taskTitle,
              status: "queued",
              priority: "medium",
              source: "manual",
              createdBy: "chat",
            }),
          });
          const task = await res.json();
          const marker = `<!--task_card ${JSON.stringify({
            id: task.id,
            shortId: task.shortId,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assignedAgentId: task.assignedAgentId,
          })} -->`;

          const assistantContent = `Task created: "${task.title}"\n\n${marker}`;
          const aMsg: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantContent,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, aMsg]);
          // Persist slash command messages via API (not going through /api/chat SSE)
          if (company?.id) {
            fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId: agentCallsign, companyId: company.id, role: "user", content: trimmed }),
            }).catch(() => {});
            fetch("/api/chat/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId: agentCallsign, companyId: company.id, role: "assistant", content: assistantContent }),
            }).catch(() => {});
          }
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Failed to create task. Check your connection.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        setIsLoading(false);
        return;
      }

      // Upload pending files
      let attachments: Attachment[] = [];
      const filesToUpload = [...pendingFiles];
      setPendingFiles([]);

      if (filesToUpload.length > 0) {
        try {
          attachments = await Promise.all(filesToUpload.map(uploadFile));
        } catch (err) {
          console.error("[chat] File upload failed:", err);
          setPendingFiles(filesToUpload); // restore on failure
          return;
        }
      }

      // Build message content — append attachment refs as markdown for the gateway
      let messageContent = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) =>
          a.mimeType.startsWith("image/")
            ? `![${a.filename}](${a.url})`
            : `[${a.filename}](${a.url})`
        ).join("\n");
        messageContent = messageContent ? `${messageContent}\n\n${refs}` : refs;
      }

      const metadata = attachments.length > 0 ? { attachments } : null;

      // Send to OpenClaw Gateway — optimistic local message (replaced by server version via SSE)
      const userMsg: Message = {
        id: `optimistic-${crypto.randomUUID()}`,
        role: "user",
        content: trimmed || "(attachments)",
        createdAt: new Date().toISOString(),
        metadata,
      };
      setMessages((prev) => [...prev, userMsg]);
      // Always scroll to bottom when user sends a message
      wasAtBottomRef.current = true;
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      // User message persisted server-side in /api/chat route
      setInput("");
      setIsLoading(true);
      setStreamingContent("");
      streamingContentRef.current = "";
      streamingAgentRef.current = agentCallsign;
      let fullContent = "";

      const chatMessages = [
        ...(speakResponses
          ? [{ role: "system" as const, content: VOICE_SYSTEM_PROMPT }]
          : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: messageContent },
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
            companyId: company?.id,
            metadata,
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

              // Handle meta events (message IDs from server-side persistence)
              if (parsed.type === "meta" && parsed.role === "user") {
                // Replace optimistic user message with server-confirmed one
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id.startsWith("optimistic-") && m.role === "user"
                      ? { ...m, id: parsed.messageId }
                      : m
                  )
                );
                continue;
              }

              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                streamingContentRef.current = fullContent;
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

        // Parse task references and inject inline card markers
        const enrichedContent = fullContent
          ? injectTaskCardMarkers(fullContent, parseTaskReferences(fullContent))
          : "No response received.";

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: enrichedContent,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        // Assistant message persisted server-side in /api/chat route
        streamingContentRef.current = "";
        streamingAgentRef.current = null;
        setStreamingContent("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // User cancelled with Escape — keep any partial content as the message
          if (fullContent) {
            const cancelledContent = fullContent + "\n\n_(cancelled)_";
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: cancelledContent,
              },
            ]);
            // Partial content persisted server-side via cancel handler
          }
          streamingContentRef.current = "";
          streamingAgentRef.current = null;
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
          streamingContentRef.current = "";
          streamingAgentRef.current = null;
          setStreamingContent("");
        }
      }

      abortControllerRef.current = null;
      setIsLoading(false);
    },
    [isLoading, voiceMode, messages, playTTS, queueSentenceForTTS, selectedAgent, speakResponses, pendingFiles, agents, isPaused, stopWords, activeSessionKey, company]
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
    storeClearAgent(activeSessionKey);
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh flex-col">
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} className="hidden" />

      {/* Header */}
      <div className="shrink-0 relative z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-2.5 w-2.5 rounded-full transition-opacity ${isPaused ? "opacity-30" : ""}`}
              style={{
                backgroundColor: isPaused ? "var(--text-tertiary)" : agentColor,
                boxShadow: isPaused ? "none" : `0 0 10px ${agentColor}80`,
              }}
            />

            {/* Paused badge */}
            {isPaused && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium tracking-wider text-amber-400">
                PAUSED
              </span>
            )}

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
      <div ref={scrollContainerRef} className="relative flex-1 overflow-y-auto px-4 py-4 lg:px-6">
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

          {messages.map((msg, i) => {
            const prevDate = i > 0 ? getDateKey(messages[i - 1].createdAt) : null;
            const currDate = getDateKey(msg.createdAt);
            const showSeparator = currDate && currDate !== prevDate;
            return (
              <div key={msg.id}>
                {showSeparator && <DateSeparator date={msg.createdAt!} />}
                <ChatMessage role={msg.role} content={msg.content} timestamp={msg.createdAt} metadata={msg.metadata} />
              </div>
            );
          })}

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

        {/* Scroll to bottom floating button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)]/90 backdrop-blur-sm px-4 py-2 text-xs text-[var(--text-secondary)] shadow-lg transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)] animate-fade-in"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
            </svg>
            Scroll to bottom
          </button>
        )}
      </div>

      {/* Agent mode fullscreen overlay */}
      {voiceMode === "agent" && (
        <div className="fixed inset-0 z-50 flex flex-col landscape:flex-row bg-[var(--bg-primary)]">
          {/* Landscape: VAD sidebar on left | Portrait: header on top */}
          <div className="landscape:flex landscape:w-[200px] landscape:shrink-0 landscape:flex-col landscape:border-r landscape:border-[var(--border-subtle)] portrait:contents">
            {/* Agent overlay header */}
            <div className="flex items-center justify-between px-4 py-2 landscape:py-2 lg:px-6 landscape:lg:px-4">
              <div className="flex items-center gap-2">
                <span className="text-lg landscape:text-base">{agentEmoji}</span>
                <span className="text-[12px] landscape:text-[11px] font-medium tracking-wider" style={{ color: agentColor }}>
                  {agentCallsign}
                </span>
              </div>
              <button
                onClick={() => setVoiceMode("off")}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 landscape:px-2 landscape:py-1 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all hover:text-[var(--text-secondary)]"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
                EXIT
              </button>
            </div>

            {/* Agent VAD interface — bottom in portrait, sidebar center in landscape */}
            <div className="shrink-0 portrait:order-last portrait:border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/80 backdrop-blur-xl px-4 py-3 landscape:py-2 landscape:flex-1 landscape:flex landscape:items-center landscape:justify-center lg:px-6 landscape:lg:px-4">
              <VoiceAgent
                onTranscript={sendMessage}
                isPlayingAudio={isPlayingAudio}
                onInterrupt={interruptAudio}
                isLoading={isLoading}
              />
            </div>
          </div>

          {/* Messages — only show completed messages in agent mode */}
          <div ref={agentScrollContainerRef} className="relative flex-1 overflow-y-auto px-4 py-4 lg:px-6 portrait:order-2">
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg, i) => {
                const prevDate = i > 0 ? getDateKey(messages[i - 1].createdAt) : null;
                const currDate = getDateKey(msg.createdAt);
                const showSeparator = currDate && currDate !== prevDate;
                return (
                  <div key={msg.id}>
                    {showSeparator && <DateSeparator date={msg.createdAt!} />}
                    <ChatMessage role={msg.role} content={msg.content} timestamp={msg.createdAt} metadata={msg.metadata} />
                  </div>
                );
              })}
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

            {/* Scroll to bottom in agent mode */}
            {showScrollButton && (
              <button
                onClick={scrollToBottom}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)]/90 backdrop-blur-sm px-4 py-2 text-xs text-[var(--text-secondary)] shadow-lg transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)] animate-fade-in"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
                </svg>
                Scroll to bottom
              </button>
            )}
          </div>
        </div>
      )}

      {/* Input area — Claude-style layout */}
      <div className={`shrink-0 bg-[var(--bg-primary)]/50 backdrop-blur-xl px-3 pb-3 pt-2 sm:px-4 lg:px-6 transition-opacity ${isPaused ? "opacity-60" : ""}`}>
        <div className="mx-auto max-w-3xl">
          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            className={`relative rounded-2xl border bg-[var(--bg-surface)] transition-colors focus-within:border-neo/30 focus-within:bg-[var(--bg-surface-hover)] ${
              isDragOver
                ? "border-[var(--accent)] bg-neo/[0.04]"
                : "border-[var(--border-medium)]"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            {/* Attachment previews */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="group relative">
                    {file.type.startsWith("image/") ? (
                      <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-[var(--border-medium)]">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
                        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        <span className="max-w-[100px] truncate">{file.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-primary)] border border-[var(--border-medium)] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--text-primary)]"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drag overlay indicator */}
            {isDragOver && (
              <div className="flex items-center justify-center py-3 px-4">
                <span className="text-[12px] text-[var(--accent)]">Drop files to attach</span>
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setShowAddMenu(false); }}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.items)
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((f): f is File => f !== null);
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              placeholder={isPaused ? `Say "${agentCallsign}" or @${agentCallsign} to resume...` : `Message ${agentCallsign}...`}
              disabled={isLoading}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base sm:text-[14px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none disabled:opacity-40"
              style={{ maxHeight: "140px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
              }}
            />

            {/* Action buttons — bottom row */}
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              {/* Left: + button and mute */}
              <div className="flex items-center gap-1">
                {/* Add to Chat (+) button */}
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  title="Add to Chat"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                    showAddMenu
                      ? "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                  }`}
                >
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>

                {/* Mute/unmute toggle */}
                <button
                  onClick={() => {
                    if (speakResponses) stopAllAudio();
                    setSpeakResponses(!speakResponses);
                  }}
                  title={speakResponses ? "Mute responses" : "Speak responses"}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                    speakResponses
                      ? "bg-neo/15 text-[var(--accent)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                  }`}
                >
                  {speakResponses ? (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                    </svg>
                  ) : (
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Right: Mic + contextual Agent/Send button */}
              <div className="flex items-center gap-1">
                {/* Mic (toggle to record) */}
                <VoiceRecorder
                  onTranscript={sendMessage}
                  isDisabled={isLoading}
                />

                {/* Contextual button: Send (when text) or Agent mode (when empty) */}
                {input.trim() || pendingFiles.length > 0 ? (
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={isLoading}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--bg-primary)] transition-all hover:opacity-90 disabled:opacity-20 disabled:cursor-not-allowed"
                    title="Send message"
                    style={
                      !isLoading
                        ? { boxShadow: "0 0 12px rgba(0, 240, 255, 0.25)" }
                        : undefined
                    }
                  >
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      // Unlock audio on iOS — must happen in user gesture handler
                      if (audioRef.current) {
                        audioRef.current.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
                        audioRef.current.play().catch(() => {});
                      }
                      setVoiceMode("agent"); setSpeakResponses(true);
                    }}
                    title="Enter agent mode (hands-free)"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-primary)] border border-[var(--border-medium)] text-[var(--text-secondary)] transition-all hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* "Add to Chat" popover menu */}
            {showAddMenu && (
              <div className="absolute bottom-full left-2 mb-2 z-20 w-64 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] shadow-xl backdrop-blur-xl animate-fade-in">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">Add to Chat</span>
                  <button
                    onClick={() => setShowAddMenu(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-all"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2 px-4 pb-3">
                  {/* Camera */}
                  <button
                    onClick={() => { cameraInputRef.current?.click(); setShowAddMenu(false); }}
                    className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                    </svg>
                    <span className="text-[11px] font-medium">Camera</span>
                  </button>
                  {/* Photos */}
                  <button
                    onClick={() => { fileInputRef.current?.setAttribute("accept", "image/*"); fileInputRef.current?.click(); setShowAddMenu(false); setTimeout(() => fileInputRef.current?.setAttribute("accept", "image/*,.pdf,.txt,.md,.csv"), 100); }}
                    className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <span className="text-[11px] font-medium">Photos</span>
                  </button>
                  {/* Files */}
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowAddMenu(false); }}
                    className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] py-3 text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-[11px] font-medium">Files</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
