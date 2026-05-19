"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VoiceAgent } from "@/components/chat/voice-agent";
import { useWorkspace } from "@/components/company-context";
import {
  playNativeVoiceAudio,
  speakNativeVoiceText,
  stopNativeVoiceAudio,
  updateNativeVoiceSessionStatus,
} from "@/lib/native-voice-session";
import { formatPageContextForPrompt, usePageContextStore } from "@/lib/page-context-store";
import {
  DEFAULT_AGENT_VOICE_SETTINGS,
  isExplicitServerVoice,
  normalizeAgentVoiceSettings,
  shouldUseDeviceTts,
  type AgentVoiceSettings,
} from "@/lib/tts-voices";

type AgentVoiceState = "idle" | "ready" | "listening" | "hearing" | "processing" | "thinking" | "speaking" | "muted" | "paused" | "error";
type TrayPinTargetType = "task" | "chat_session" | "chat_thread";
type MiniChatMessage = { id: string; role: "user" | "assistant" | "tool"; content: string };

export type ActiveAgentVoiceSession = {
  agentCallsign: string;
  agentName?: string | null;
  agentColor?: string | null;
  sessionKey: string;
  channelId?: string | null;
  channelName?: string | null;
  channelType?: string | null;
  title?: string | null;
  threadSessionKey?: string | null;
  runtimeId?: string | null;
  voiceSettings?: AgentVoiceSettings | null;
};

export type TrayPin = {
  id: string;
  targetType: TrayPinTargetType;
  targetId?: string | null;
  targetKey: string;
  title: string;
  metadata?: Record<string, unknown> | null;
  sortIndex: number;
};

type PinTargetInput = {
  targetType: TrayPinTargetType;
  targetId?: string | null;
  targetKey?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AgentVoiceSessionContextValue = {
  activeSession: ActiveAgentVoiceSession | null;
  voiceState: AgentVoiceState;
  micMuted: boolean;
  audioMuted: boolean;
  isPlayingAudio: boolean;
  voiceLevel: number;
  systemPinned: boolean;
  userPinned: boolean;
  visible: boolean;
  pins: TrayPin[];
  setActiveSession: (session: ActiveAgentVoiceSession | null) => void;
  setVoiceState: (state: AgentVoiceState) => void;
  setMicMuted: (muted: boolean) => void;
  setAudioMuted: (muted: boolean) => void;
  setIsPlayingAudio: (playing: boolean) => void;
  setVoiceLevel: (level: number) => void;
  setUserPinned: (pinned: boolean) => void;
  stopSession: () => void;
  pinTarget: (input: PinTargetInput) => Promise<TrayPin | null>;
  removePin: (id: string) => Promise<void>;
  refreshPins: () => Promise<void>;
};

const AgentVoiceSessionContext = createContext<AgentVoiceSessionContextValue | null>(null);
const INACTIVE_TRAY_GRACE_MS = 30_000;
const CHAT_AGENT_STORAGE_KEY = "crewcmd.chat.selected-agent";
const CHAT_SESSION_STORAGE_KEY = "crewcmd.chat.selected-session";

function activeAgentStorageKey(workspaceId?: string | null, sessionKey?: string | null) {
  return `crewcmd.tray.activeAgentPinned.${workspaceId ?? "global"}.${sessionKey ?? "none"}`;
}

function isActiveState(state: AgentVoiceState) {
  return state === "ready" || state === "listening" || state === "hearing" || state === "processing" || state === "thinking" || state === "speaking" || state === "muted";
}

function clampVoiceLevel(level: number) {
  return Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
}

function createMiniChatId() {
  return `tray-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isNativeCapacitorApp() {
  if (typeof window === "undefined") return false;
  const capacitor = (window as Window & {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
    };
  }).Capacitor;
  if (!capacitor) return false;
  if (capacitor.isNativePlatform?.()) return true;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read audio blob"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio blob"));
    reader.readAsDataURL(blob);
  });
}

function stripMarkdownForSpeech(markdown: string) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function miniProgressContent(parsed: unknown) {
  const record = asRecord(parsed);
  if (!record || record.type !== "chat_progress") return null;
  const tool = asRecord(record.activeTool);
  if (tool) {
    const name = firstString(tool.name) ?? "Tool";
    const status = firstString(tool.status, record.event) ?? "working";
    const detail = firstString(tool.detail);
    return detail ? `${name}: ${status}\n${detail}` : `${name}: ${status}`;
  }
  const checkpoint = asRecord(record.checkpoint);
  if (checkpoint) {
    const title = firstString(checkpoint.title) ?? "Checkpoint";
    const summary = firstString(checkpoint.summary, checkpoint.detail);
    return summary ? `${title}\n${summary}` : title;
  }
  const event = firstString(record.event);
  if (event === "run_started") return "Agent started";
  if (event === "run_completed") return "Agent completed";
  if (event === "run_error") return firstString(record.error) ?? "Agent hit an error";
  return null;
}

function pinHref(pin: TrayPin) {
  const metadata = pin.metadata ?? {};
  if (pin.targetType === "task") return `/tasks?taskId=${encodeURIComponent(pin.targetId ?? pin.targetKey)}`;
  const channelId = typeof metadata.channelId === "string" ? metadata.channelId : null;
  if (channelId) {
    const params = new URLSearchParams({ channelId, pane: "chat" });
    return `/chat?${params.toString()}`;
  }
  if (pin.targetType === "chat_thread") {
    const agent = typeof metadata.agentId === "string" ? metadata.agentId : null;
    const sessionKey = typeof metadata.threadSessionKey === "string" ? metadata.threadSessionKey : pin.targetKey;
    const params = new URLSearchParams({ sessionKey });
    if (agent) params.set("agent", agent);
    return `/chat?${params.toString()}`;
  }
  const agent = typeof metadata.agentId === "string" ? metadata.agentId : null;
  const sessionKey = typeof metadata.gatewaySessionKey === "string" ? metadata.gatewaySessionKey : pin.targetKey;
  const params = new URLSearchParams({ sessionKey });
  if (agent) params.set("agent", agent);
  return `/chat?${params.toString()}`;
}

const TRAY_TASK_STATUSES = ["backlog", "inbox", "queued", "in_progress", "review", "done"] as const;

function pinMetaString(pin: TrayPin, key: string) {
  const value = pin.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pinMetaNumber(pin: TrayPin, key: string) {
  const value = pin.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function pinShortLabel(pin: TrayPin) {
  if (pin.targetType === "task") {
    const shortId = pinMetaNumber(pin, "shortId");
    return shortId ? `TSK-${String(shortId).padStart(4, "0")}` : "TASK";
  }
  return pinMetaString(pin, "agentId")?.slice(0, 2).toUpperCase() ?? "CH";
}

function isChatPin(pin: TrayPin) {
  return pin.targetType === "chat_session" || pin.targetType === "chat_thread";
}

function chatPinInitials(pin: TrayPin) {
  const channel = pinMetaString(pin, "channelName") ?? pin.title;
  if (pinMetaString(pin, "channelId")) return channel.replace(/^#/, "").slice(0, 2).toUpperCase();
  const agent = pinMetaString(pin, "agentId") ?? pinMetaString(pin, "storageAgentId");
  if (agent) return agent.slice(0, 2).toUpperCase();
  return channel.replace(/^#/, "").slice(0, 2).toUpperCase();
}

function trayInitials(value: string) {
  return value.replace(/^#/, "").slice(0, 2).toUpperCase();
}

export function AgentVoiceSessionProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const [activeSession, setActiveSessionState] = useState<ActiveAgentVoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<AgentVoiceState>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [voiceLevel, setVoiceLevelState] = useState(0);
  const [userPinned, setUserPinnedState] = useState(false);
  const [inactiveVisible, setInactiveVisible] = useState(false);
  const [pins, setPins] = useState<TrayPin[]>([]);
  const inactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const systemPinned = Boolean(activeSession && (isPlayingAudio || isActiveState(voiceState)));
  const visible = Boolean(activeSession && (systemPinned || userPinned || inactiveVisible));

  const clearInactiveTimer = useCallback(() => {
    if (!inactiveTimerRef.current) return;
    clearTimeout(inactiveTimerRef.current);
    inactiveTimerRef.current = null;
  }, []);

  const refreshPins = useCallback(async () => {
    if (!workspace?.id) return;
    const params = new URLSearchParams({ workspaceId: workspace.id });
    if (workspace.companyId) params.set("companyId", workspace.companyId);
    const response = await fetch(`/api/tray/pins?${params.toString()}`);
    if (!response.ok) return;
    const data = await response.json() as { pins?: TrayPin[] };
    setPins(data.pins ?? []);
  }, [workspace?.companyId, workspace?.id]);

  useEffect(() => {
    void refreshPins();
  }, [refreshPins]);

  useEffect(() => {
    const handleRefresh = () => void refreshPins();
    window.addEventListener("crewcmd:tray-pins-refresh", handleRefresh);
    return () => window.removeEventListener("crewcmd:tray-pins-refresh", handleRefresh);
  }, [refreshPins]);

  useEffect(() => {
    if (!activeSession) {
      setUserPinnedState(false);
      setInactiveVisible(false);
      clearInactiveTimer();
      return;
    }
    const stored = localStorage.getItem(activeAgentStorageKey(workspace?.id, activeSession.sessionKey));
    setUserPinnedState(stored === "true");
  }, [activeSession, clearInactiveTimer, workspace?.id]);

  useEffect(() => {
    if (!activeSession) return;
    if (systemPinned) {
      clearInactiveTimer();
      setInactiveVisible(true);
      return;
    }
    if (userPinned) return;
    clearInactiveTimer();
    inactiveTimerRef.current = setTimeout(() => {
      setInactiveVisible(false);
    }, INACTIVE_TRAY_GRACE_MS);
    return clearInactiveTimer;
  }, [activeSession, clearInactiveTimer, systemPinned, userPinned]);

  const setActiveSession = useCallback((session: ActiveAgentVoiceSession | null) => {
    setActiveSessionState(session);
    if (session) {
      setInactiveVisible(true);
    } else {
      setVoiceState("idle");
      setIsPlayingAudio(false);
      setVoiceLevelState(0);
      setMicMuted(false);
      setAudioMuted(false);
    }
  }, []);

  const setUserPinned = useCallback((pinned: boolean) => {
    setUserPinnedState(pinned);
    if (!activeSession) return;
    localStorage.setItem(activeAgentStorageKey(workspace?.id, activeSession.sessionKey), pinned ? "true" : "false");
  }, [activeSession, workspace?.id]);

  const pinTarget = useCallback(async (input: PinTargetInput) => {
    if (!workspace?.id) return null;
    const response = await fetch("/api/tray/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspace.id,
        companyId: workspace.companyId,
        ...input,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { pin?: TrayPin };
    await refreshPins();
    return data.pin ?? null;
  }, [refreshPins, workspace?.companyId, workspace?.id]);

  const removePin = useCallback(async (id: string) => {
    const response = await fetch(`/api/tray/pins?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) return;
    setPins((current) => current.filter((pin) => pin.id !== id));
  }, []);

  const stopSession = useCallback(() => {
    window.dispatchEvent(new CustomEvent("crewcmd:agent-voice-stop"));
    window.speechSynthesis?.cancel();
    void stopNativeVoiceAudio().catch(() => {});
    const audio = document.querySelector<HTMLAudioElement>("[data-agent-voice-session-audio]");
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
    }
    setVoiceState("idle");
    setIsPlayingAudio(false);
    setVoiceLevelState(0);
    setMicMuted(false);
    setAudioMuted(false);
    setActiveSessionState(null);
  }, []);

  const setVoiceLevel = useCallback((level: number) => {
    setVoiceLevelState(clampVoiceLevel(level));
  }, []);

  const value = useMemo<AgentVoiceSessionContextValue>(() => ({
    activeSession,
    voiceState,
    micMuted,
    audioMuted,
    isPlayingAudio,
    voiceLevel,
    systemPinned,
    userPinned,
    visible,
    pins,
    setActiveSession,
    setVoiceState,
    setMicMuted,
    setAudioMuted,
    setIsPlayingAudio,
    setVoiceLevel,
    setUserPinned,
    stopSession,
    pinTarget,
    removePin,
    refreshPins,
  }), [
    activeSession,
    audioMuted,
    isPlayingAudio,
    micMuted,
    pinTarget,
    pins,
    refreshPins,
    removePin,
    setActiveSession,
    setUserPinned,
    setVoiceLevel,
    stopSession,
    systemPinned,
    userPinned,
    visible,
    voiceLevel,
    voiceState,
  ]);

  return (
    <AgentVoiceSessionContext.Provider value={value}>
      {children}
      <audio data-agent-voice-session-audio className="hidden" />
    </AgentVoiceSessionContext.Provider>
  );
}

export function useAgentVoiceSession() {
  const value = useContext(AgentVoiceSessionContext);
  if (!value) throw new Error("useAgentVoiceSession must be used within AgentVoiceSessionProvider");
  return value;
}

function ActiveAgentTrayItem() {
  const tray = useAgentVoiceSession();
  const pathname = usePathname();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const pageContext = usePageContextStore((state) => state.context);
  const [expanded, setExpanded] = useState(false);
  const [miniInput, setMiniInput] = useState("");
  const [miniMessages, setMiniMessages] = useState<MiniChatMessage[]>([]);
  const [miniSending, setMiniSending] = useState(false);
  const lastNativeStatusRef = useRef({ at: 0, key: "" });
  const active = tray.activeSession;
  const activeChannelLabel = active?.channelName
    ? `${active.channelType === "dm" ? "" : "#"}${active.channelName}`
    : null;
  const activeDisplayTitle = active ? activeChannelLabel ?? active.title ?? active.agentName ?? active.agentCallsign : "";
  const activeBubbleInitials = active
    ? activeChannelLabel
      ? trayInitials(activeChannelLabel)
      : active.agentCallsign.slice(0, 2).toUpperCase()
    : "";
  const activePlaceholder = active ? activeChannelLabel ?? active.agentCallsign.toUpperCase() : "";

  useEffect(() => {
    if (!active || pathname === "/chat" || !tray.systemPinned || tray.voiceState !== "ready") return;
    tray.setVoiceState("listening");
  }, [active, pathname, tray]);

  const nativeActor = tray.isPlayingAudio || tray.voiceState === "speaking" || tray.voiceState === "thinking" || tray.voiceState === "processing"
    ? "agent"
    : tray.voiceState === "listening" || tray.voiceState === "hearing"
      ? "user"
      : "system";
  useEffect(() => {
    if (!active || !tray.visible || !isNativeCapacitorApp()) return;
    const levelBucket = Math.round(tray.voiceLevel * 20);
    const key = [
      tray.voiceState,
      nativeActor,
      levelBucket,
      tray.systemPinned ? "active" : "recent",
      active.agentCallsign,
      activeDisplayTitle,
    ].join(":");
    const now = Date.now();
    if (lastNativeStatusRef.current.key === key && now - lastNativeStatusRef.current.at < 250) return;
    lastNativeStatusRef.current = { at: now, key };
    void updateNativeVoiceSessionStatus({
      state: tray.voiceState,
      active: tray.systemPinned,
      actor: nativeActor,
      level: tray.voiceLevel,
      agentCallsign: active.agentCallsign,
      title: activeDisplayTitle,
    }).catch(() => {});
  }, [
    active,
    activeDisplayTitle,
    nativeActor,
    tray.systemPinned,
    tray.visible,
    tray.voiceLevel,
    tray.voiceState,
  ]);

  if (!active || !tray.visible) return null;
  if (pathname === "/chat" && !expanded) return null;

  const voiceSettings = normalizeAgentVoiceSettings(active.voiceSettings ?? DEFAULT_AGENT_VOICE_SETTINGS);

  const openFullChat = () => {
    if (active.channelId) {
      const params = new URLSearchParams({ channelId: active.channelId, pane: "chat" });
      router.push(`/chat?${params.toString()}`);
      setExpanded(false);
      return;
    }
    const params = new URLSearchParams({ sessionKey: active.threadSessionKey ?? active.sessionKey });
    params.set("agent", active.agentCallsign);
    params.set("pane", "chat");
    window.localStorage.setItem(CHAT_AGENT_STORAGE_KEY, active.agentCallsign.toLowerCase());
    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, active.threadSessionKey ?? active.sessionKey);
    router.push(`/chat?${params.toString()}`);
    setExpanded(false);
  };

  const playTrayTTS = async (text: string) => {
    const speechText = stripMarkdownForSpeech(text);
    if (tray.audioMuted || voiceSettings.enabled === false || !speechText) return;
    tray.setVoiceState("speaking");
    tray.setIsPlayingAudio(true);
    try {
      const useDeviceSpeech = shouldUseDeviceTts(voiceSettings);
      const usesExplicitServerVoice = isExplicitServerVoice(voiceSettings);
      if (isNativeCapacitorApp() && useDeviceSpeech && !usesExplicitServerVoice) {
        const nativeSpeech = await speakNativeVoiceText({
          text: speechText,
          playbackRate: voiceSettings.speed ?? 1.15,
          voiceId: voiceSettings.voiceId,
          voiceName: voiceSettings.voiceName,
        });
        if (nativeSpeech) return;
      }
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speechText, voice: voiceSettings }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      if (isNativeCapacitorApp()) {
        await playNativeVoiceAudio({
          dataBase64: await blobToBase64(blob),
          contentType: blob.type || response.headers.get("Content-Type") || "audio/mpeg",
          playbackRate: voiceSettings.speed ?? 1.15,
        });
        return;
      }
      const audio = document.querySelector<HTMLAudioElement>("[data-agent-voice-session-audio]");
      if (!audio) return;
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.src = url;
        audio.playbackRate = voiceSettings.speed ?? 1.15;
        void audio.play().catch(() => resolve());
      });
    } finally {
      tray.setIsPlayingAudio(false);
      tray.setVoiceState(tray.micMuted ? "muted" : "listening");
    }
  };

  const sendMiniMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || miniSending) return;
    setMiniInput("");
    setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "user", content: trimmed }]);
    setMiniSending(true);
    tray.setVoiceState("thinking");
    try {
      const pageContextPrompt = formatPageContextForPrompt(pageContext);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are replying through the compact CrewCMD tray. Keep the answer concise and useful." },
            ...(pageContextPrompt ? [{ role: "system", content: pageContextPrompt }] : []),
            ...miniMessages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
            { role: "user", content: trimmed },
          ],
          agent: active.agentCallsign,
          gatewayAgent: active.agentCallsign,
          companyId: workspace?.companyId,
          workspaceId: workspace?.id,
          pageContext,
          sessionKey: active.threadSessionKey ?? active.sessionKey,
          agentMode: true,
          clientVisibility: typeof document !== "undefined" && document.hidden ? "hidden" : "visible",
          notifyOnCompletion: true,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let content = "";
      const handleFrame = (frame: string) => {
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) return;
        const data = dataLines.join("\n");
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const progressContent = miniProgressContent(parsed);
          if (progressContent) {
            setMiniMessages((current) => {
              const last = current.at(-1);
              if (last?.role === "tool") {
                return [...current.slice(0, -1), { ...last, content: progressContent }];
              }
              return [...current, { id: createMiniChatId(), role: "tool", content: progressContent }];
            });
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
        } catch {
          // Ignore progress/meta frames that are not model deltas.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const frames = sseBuffer.split("\n\n");
        sseBuffer = frames.pop() ?? "";
        for (const frame of frames) handleFrame(frame);
      }
      if (sseBuffer.trim()) handleFrame(sseBuffer);
      const answer = content.trim();
      if (answer) {
        setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "assistant", content: answer }]);
        await playTrayTTS(answer);
      }
    } catch {
      tray.setVoiceState("error");
      setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "assistant", content: "I could not send that from the tray. Try again from the full chat." }]);
    } finally {
      setMiniSending(false);
      if (tray.voiceState !== "error") tray.setVoiceState(tray.micMuted ? "muted" : "listening");
    }
  };

  const interruptTrayAudio = () => {
    window.speechSynthesis?.cancel();
    void stopNativeVoiceAudio().catch(() => {});
    const audio = document.querySelector<HTMLAudioElement>("[data-agent-voice-session-audio]");
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    tray.setIsPlayingAudio(false);
  };

  const pinnedLabel = tray.userPinned ? "Unpin active agent" : "Pin active agent";
  const stateTone = tray.voiceState === "speaking"
    ? "var(--accent)"
    : tray.voiceState === "thinking" || tray.voiceState === "processing"
      ? active.agentColor ?? "var(--accent)"
    : tray.voiceState === "error" || tray.voiceState === "paused"
      ? "var(--danger)"
      : tray.voiceState === "ready"
        ? "var(--text-tertiary)"
        : active.agentColor ?? "var(--accent)";
  const visualActor = nativeActor === "agent" ? "agent" : "user";
  const visualTone = visualActor === "agent" ? (active.agentColor ?? "var(--accent)") : "var(--voice-listening, #d9b96e)";
  const visualLevel = tray.isPlayingAudio
    ? Math.max(tray.voiceLevel, 0.24)
    : tray.voiceState === "thinking" || tray.voiceState === "processing"
      ? 0.32
    : tray.voiceState === "listening" || tray.voiceState === "hearing"
      ? Math.max(tray.voiceLevel, 0.08)
      : 0;
  const visualBars = [0.45, 0.78, 0.58, 0.92].map((weight, index) => {
    const lift = tray.isPlayingAudio ? 0.28 : 0.16;
    return Math.max(0.18, Math.min(1, visualLevel * weight + lift + index * 0.035));
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-white shadow-2xl transition hover:scale-[1.02]"
        aria-label="Open active agent bubble"
        title={`${activeDisplayTitle}: ${tray.voiceState}`}
      >
        <span className="absolute inset-0 rounded-full border-2 opacity-70" style={{ borderColor: stateTone }} />
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: active.agentColor ?? "var(--accent)" }}>
            {activeBubbleInitials}
        </span>
        {(tray.voiceState === "listening" || tray.voiceState === "hearing" || tray.voiceState === "thinking" || tray.voiceState === "processing" || tray.voiceState === "speaking") ? (
          <span className="absolute -bottom-0.5 flex h-4 items-end gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5" aria-hidden="true">
            {visualBars.map((bar, index) => (
              <span
                key={index}
                className={`w-0.5 rounded-full transition-[height,background-color] duration-100 ${nativeActor === "agent" ? "animate-pulse" : ""}`}
                style={{
                  height: `${5 + bar * 9}px`,
                  backgroundColor: visualTone,
                }}
              />
            ))}
          </span>
        ) : null}
      </button>

      {expanded && (
        <div className="fixed inset-0 z-[75] flex items-end bg-black/30 lg:items-center lg:justify-end" onClick={() => setExpanded(false)}>
          <div className="w-full rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-2xl lg:mr-6 lg:max-w-sm lg:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeDisplayTitle}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{tray.voiceState}{tray.systemPinned ? " / active" : " / recent"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={openFullChat} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]" aria-label="Open full chat" title="Open full chat">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 9.75V4.5h5.25M19.5 14.25v5.25h-5.25M19.5 4.5l-6.75 6.75M4.5 19.5l6.75-6.75" />
                  </svg>
                </button>
                <button type="button" onClick={() => setExpanded(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Close active agent sheet" title="Close">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              <IconButton
                active={!tray.micMuted}
                danger={tray.micMuted}
                label={tray.micMuted ? "Unmute microphone" : "Mute microphone"}
                onClick={() => tray.setMicMuted(!tray.micMuted)}
                icon={tray.micMuted ? "mic-off" : "mic"}
              />
              <IconButton
                active={!tray.audioMuted}
                danger={tray.audioMuted}
                label={tray.audioMuted ? "Unmute audio" : "Mute audio"}
                onClick={() => tray.setAudioMuted(!tray.audioMuted)}
                icon={tray.audioMuted ? "volume-off" : "volume"}
              />
              <IconButton active={tray.userPinned} label={pinnedLabel} onClick={() => tray.setUserPinned(!tray.userPinned)} icon="pin" />
              <IconButton danger label="Stop active agent" onClick={tray.stopSession} icon="stop" />
            </div>
            <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 p-2">
              {miniMessages.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-[var(--text-tertiary)]">Ask about this page or keep talking.</div>
              ) : miniMessages.map((message) => (
                <div key={message.id} className={`rounded-xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-8 bg-[var(--accent-soft)] text-[var(--text-primary)]"
                    : message.role === "tool"
                      ? "mx-4 border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]"
                      : "mr-8 bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                }`}>
                  <div className="prose prose-sm max-w-none text-inherit prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-[var(--text-primary)] prose-code:rounded prose-code:bg-[var(--bg-surface-hover)] prose-code:px-1 prose-code:text-[var(--accent)] prose-a:text-[var(--accent)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMiniMessage(miniInput);
              }}
            >
              <textarea
                value={miniInput}
                onChange={(event) => setMiniInput(event.target.value)}
                rows={1}
                placeholder={`Message ${activePlaceholder}...`}
                className="min-h-10 flex-1 resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
              />
              <button type="submit" disabled={miniSending || !miniInput.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white disabled:opacity-45" aria-label="Send tray message">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
      {pathname !== "/chat" && tray.systemPinned ? (
        <div className="pointer-events-none fixed h-px w-px overflow-hidden opacity-0" aria-hidden="true">
          <VoiceAgent
            onTranscript={(text) => void sendMiniMessage(text)}
            isPlayingAudio={tray.isPlayingAudio}
            onInterrupt={interruptTrayAudio}
            isLoading={miniSending || tray.voiceState === "thinking" || tray.voiceState === "processing"}
            accentColor={active.agentColor ?? undefined}
            autoActivate
            compact
            isMicMuted={tray.micMuted}
            isAgentMuted={tray.audioMuted}
            onMicMutedChange={tray.setMicMuted}
            onAgentMutedChange={tray.setAudioMuted}
            onVoiceLevel={tray.setVoiceLevel}
            agent={active.agentCallsign}
            gatewayAgent={active.agentCallsign}
            companyId={workspace?.companyId ?? undefined}
            sessionKey={active.threadSessionKey ?? active.sessionKey}
            realtimeRuntimeId={active.runtimeId ?? undefined}
          />
        </div>
      ) : null}
    </>
  );
}

function IconButton({
  active = false,
  danger = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  danger?: boolean;
  icon: "mic" | "mic-off" | "volume" | "volume-off" | "pin" | "stop";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
        danger
          ? "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
          : active
            ? "border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
      }`}
      aria-label={label}
      title={label}
    >
      <ControlIcon icon={icon} />
    </button>
  );
}

function ControlIcon({ icon }: { icon: "mic" | "mic-off" | "volume" | "volume-off" | "pin" | "stop" }) {
  if (icon === "mic" || icon === "mic-off") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75v2.25m0-2.25a6.75 6.75 0 0 0 6.75-6.75M12 18.75A6.75 6.75 0 0 1 5.25 12M9 6.75a3 3 0 1 1 6 0V12a3 3 0 1 1-6 0V6.75Z" />
        {icon === "mic-off" ? <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15" /> : null}
      </svg>
    );
  }
  if (icon === "volume" || icon === "volume-off") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.5a2.25 2.25 0 0 1-2.25-2.25v-3A2.25 2.25 0 0 1 4.5 8.25h2.25Z" />
        {icon === "volume" ? <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 8.25a5.25 5.25 0 0 1 0 7.5" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 9.75 21 12m0 0 2.25 2.25M21 12l2.25-2.25M21 12l-2.25 2.25" />}
      </svg>
    );
  }
  if (icon === "pin") {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 4.5 19.5 9.75m-10.5 0L4.5 14.25l5.25 5.25 4.5-4.5m-5.25-5.25 5.25 5.25m-5.25-5.25 3-3a2.121 2.121 0 0 1 3 0l2.25 2.25a2.121 2.121 0 0 1 0 3l-3 3" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function ManualPins() {
  const { activeSession, visible: activeSessionVisible, pins, removePin, refreshPins } = useAgentVoiceSession();
  const { workspace } = useWorkspace();
  const pageContext = usePageContextStore((state) => state.context);
  const [activeTaskPin, setActiveTaskPin] = useState<TrayPin | null>(null);
  const [activeChatPin, setActiveChatPin] = useState<TrayPin | null>(null);
  const [miniMessages, setMiniMessages] = useState<MiniChatMessage[]>([]);
  const [miniInput, setMiniInput] = useState("");
  const [miniSending, setMiniSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const activeSessionKey = activeSession?.threadSessionKey ?? activeSession?.sessionKey ?? null;
  const activeChannelId = activeSession?.channelId ?? null;
  const chatPins = pins.filter((pin) => {
    if (!isChatPin(pin)) return false;
    if (!activeSessionVisible || !activeSessionKey) return true;
    const pinChannelId = pinMetaString(pin, "channelId");
    if (activeChannelId) {
      return pinChannelId !== activeChannelId && pin.targetKey !== `channel:${activeChannelId}`;
    }
    if (pinChannelId) return true;
    return pin.targetKey !== activeSessionKey && pinMetaString(pin, "threadSessionKey") !== activeSessionKey && pinMetaString(pin, "gatewaySessionKey") !== activeSessionKey;
  });
  const taskPins = pins.filter((pin) => pin.targetType === "task");
  if (chatPins.length === 0 && taskPins.length === 0) return null;

  const updateTaskStatus = async (pin: TrayPin, status: string) => {
    const taskId = pin.targetId ?? pin.targetKey;
    if (!taskId || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const taskResponse = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!taskResponse.ok) return;
      const metadata = { ...(pin.metadata ?? {}), status };
      await fetch("/api/tray/pins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pin.id, metadata }),
      });
      setActiveTaskPin({ ...pin, metadata });
      await refreshPins();
    } finally {
      setUpdatingStatus(false);
    }
  };

  const sendPinnedChatMessage = async (pin: TrayPin, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || miniSending) return;
    setMiniInput("");
    setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "user", content: trimmed }]);
    setMiniSending(true);
    try {
      const metadata = pin.metadata ?? {};
      const channelId = typeof metadata.channelId === "string" && metadata.channelId ? metadata.channelId : null;
      const agent = typeof metadata.agentId === "string" && metadata.agentId ? metadata.agentId : undefined;
      const storageAgent = typeof metadata.storageAgentId === "string" && metadata.storageAgentId
        ? metadata.storageAgentId
        : agent;
      const sessionKey = pin.targetType === "chat_thread"
        ? (typeof metadata.threadSessionKey === "string" && metadata.threadSessionKey ? metadata.threadSessionKey : pin.targetKey)
        : (typeof metadata.gatewaySessionKey === "string" && metadata.gatewaySessionKey ? metadata.gatewaySessionKey : pin.targetKey);
      if (channelId && !agent) {
        const response = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: storageAgent ?? "channel",
            companyId: workspace?.companyId,
            workspaceId: workspace?.id,
            channelId,
            gatewaySessionKey: sessionKey,
            role: "user",
            content: trimmed,
            metadata: { source: "tray", pageContext },
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json().catch(() => null);
        window.dispatchEvent(new CustomEvent("crewcmd:tray-channel-message", {
          detail: {
            channelId,
            content: trimmed,
            createdAt: typeof data?.message?.createdAt === "string" ? data.message.createdAt : new Date().toISOString(),
            messageId: typeof data?.message?.id === "string" ? data.message.id : createMiniChatId(),
          },
        }));
        setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "tool", content: `Sent to ${pin.title}` }]);
        return;
      }
      const pageContextPrompt = formatPageContextForPrompt(pageContext);
      const recentMessages = miniMessages
        .slice(-8)
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are replying through a compact pinned chat tray. Keep the answer concise and useful." },
            ...(pageContextPrompt ? [{ role: "system", content: pageContextPrompt }] : []),
            ...recentMessages,
            { role: "user", content: trimmed },
          ],
          agent,
          gatewayAgent: agent,
          companyId: workspace?.companyId,
          workspaceId: workspace?.id,
          pageContext,
          sessionKey,
          agentMode: Boolean(agent),
          clientVisibility: typeof document !== "undefined" && document.hidden ? "hidden" : "visible",
          notifyOnCompletion: true,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let content = "";
      const handleFrame = (frame: string) => {
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));
        if (dataLines.length === 0) return;
        const data = dataLines.join("\n");
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const progressContent = miniProgressContent(parsed);
          if (progressContent) {
            setMiniMessages((current) => {
              const last = current.at(-1);
              if (last?.role === "tool") return [...current.slice(0, -1), { ...last, content: progressContent }];
              return [...current, { id: createMiniChatId(), role: "tool", content: progressContent }];
            });
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
        } catch {
          // Ignore progress/meta frames that are not model deltas.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const frames = sseBuffer.split("\n\n");
        sseBuffer = frames.pop() ?? "";
        for (const frame of frames) handleFrame(frame);
      }
      if (sseBuffer.trim()) handleFrame(sseBuffer);
      const answer = content.trim();
      if (answer) setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "assistant", content: answer }]);
    } catch {
      setMiniMessages((current) => [...current, { id: createMiniChatId(), role: "assistant", content: "I could not send that from the tray. Open the full chat and try again." }]);
    } finally {
      setMiniSending(false);
    }
  };

  const visiblePins = taskPins.slice(0, 3);

  return (
    <>
      {chatPins.length > 0 ? (
        <div className="group/ml-auto ml-auto flex max-w-full flex-row-reverse items-center gap-0 transition-[gap] hover:gap-1.5 lg:flex-col-reverse">
          {chatPins.slice(0, 5).map((pin) => (
            <div key={pin.id} className="group relative -mr-3 transition-[margin,transform] hover:z-10 hover:scale-[1.03] group-hover/ml-auto:mr-0 lg:-mb-3 lg:mr-0 lg:group-hover/ml-auto:mb-0">
              <button
                type="button"
                onClick={() => {
                  setActiveChatPin(pin);
                  setMiniMessages([]);
                }}
                className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-[color-mix(in_srgb,var(--accent)_72%,white_10%)] bg-[var(--accent)] text-xs font-bold text-white shadow-2xl transition hover:scale-[1.03]"
                title={pin.title}
                aria-label={`Open pinned chat ${pin.title}`}
              >
                {chatPinInitials(pin)}
              </button>
              <button type="button" onClick={() => void removePin(pin.id)} className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[10px] text-[var(--text-tertiary)] opacity-0 shadow transition hover:text-[var(--text-primary)] group-hover:opacity-100" aria-label={`Remove ${pin.title} from tray`}>
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {visiblePins.length > 0 ? (
        <div className="ml-auto flex max-w-[min(28rem,calc(100vw-1.5rem))] gap-1.5 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2 shadow-lg lg:max-w-[18rem]">
          {visiblePins.map((pin) => {
            const content = (
              <>
                <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--text-tertiary)]">
                  {pinShortLabel(pin)}
                </span>
                <span className="max-w-32 truncate text-xs font-medium text-[var(--text-secondary)] lg:max-w-24">{pin.title}</span>
              </>
            );
            return (
              <div key={pin.id} className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-surface)] px-2 py-1">
                <button type="button" onClick={() => setActiveTaskPin(pin)} className="flex min-w-0 items-center gap-1.5 hover:text-[var(--text-primary)]" title={pin.title}>
                  {content}
                </button>
                <button type="button" onClick={() => void removePin(pin.id)} className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]" aria-label={`Remove ${pin.title} from tray`}>
                  x
                </button>
              </div>
            );
          })}
          {taskPins.length > visiblePins.length ? (
            <div className="flex shrink-0 items-center rounded-md bg-[var(--bg-surface)] px-2 py-1 text-xs font-semibold text-[var(--text-tertiary)]">
              +{taskPins.length - visiblePins.length}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTaskPin ? (
        <div className="fixed inset-0 z-[76] flex items-end bg-black/30 lg:items-center lg:justify-end" onClick={() => setActiveTaskPin(null)}>
          <div className="w-full rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-2xl lg:mr-6 lg:max-w-md lg:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{pinShortLabel(activeTaskPin)}</div>
                <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeTaskPin.title}</h3>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">{pinMetaString(activeTaskPin, "projectName") ?? "No project"}</p>
              </div>
              <button type="button" onClick={() => setActiveTaskPin(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Close task pin">
                x
              </button>
            </div>
            <p className="max-h-28 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              {pinMetaString(activeTaskPin, "description") ?? "No description."}
            </p>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Status
              <select
                value={pinMetaString(activeTaskPin, "status") ?? "inbox"}
                disabled={updatingStatus}
                onChange={(event) => void updateTaskStatus(activeTaskPin, event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                {TRAY_TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replace("_", " ")}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex gap-2">
              <Link href={pinHref(activeTaskPin)} className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-center text-xs font-semibold text-white">
                Open task
              </Link>
              <button type="button" onClick={() => void removePin(activeTaskPin.id).then(() => setActiveTaskPin(null))} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                Unpin
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeChatPin ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--mobile-app-bar-height)+4.5rem)] z-[76] flex justify-end lg:inset-auto lg:bottom-24 lg:right-4">
          <div className="pointer-events-auto w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/92 p-4 shadow-2xl backdrop-blur-md lg:w-[26rem]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{pinShortLabel(activeChatPin)}</div>
                <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeChatPin.title}</h3>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">Pinned chat</p>
              </div>
              <div className="flex items-center gap-1">
                <Link href={pinHref(activeChatPin)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Open full chat" title="Open full chat">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 9.75V4.5h5.25M19.5 14.25v5.25h-5.25M19.5 4.5l-6.75 6.75M4.5 19.5l6.75-6.75" />
                  </svg>
                </Link>
                <button type="button" onClick={() => setActiveChatPin(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Close pinned chat">
                  x
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 p-2">
              {miniMessages.length === 0 ? (
                <div className="px-2 py-8 text-center text-xs text-[var(--text-tertiary)]">Ask this chat about the page you are viewing.</div>
              ) : miniMessages.map((message) => (
                <div key={message.id} className={`rounded-xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-8 bg-[var(--accent-soft)] text-[var(--text-primary)]"
                    : message.role === "tool"
                      ? "mx-4 border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]"
                      : "mr-8 bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                }`}>
                  <div className="prose prose-sm max-w-none text-inherit prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-[var(--text-primary)] prose-code:rounded prose-code:bg-[var(--bg-surface-hover)] prose-code:px-1 prose-code:text-[var(--accent)] prose-a:text-[var(--accent)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendPinnedChatMessage(activeChatPin, miniInput);
              }}
            >
              <textarea
                value={miniInput}
                onChange={(event) => setMiniInput(event.target.value)}
                rows={1}
                placeholder={`Message ${activeChatPin.title}...`}
                className="min-h-10 flex-1 resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
              />
              <button type="submit" disabled={miniSending || !miniInput.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white disabled:opacity-45" aria-label="Send pinned chat message">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            </form>
            <button type="button" onClick={() => void removePin(activeChatPin.id).then(() => setActiveChatPin(null))} className="mt-3 w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              Unpin chat
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AppTray() {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/access-denied" || pathname.startsWith("/invite/")) return null;
  const mobileBottom = pathname === "/chat"
    ? "bottom-[calc(var(--mobile-app-bar-height)+7.25rem)]"
    : "bottom-[calc(var(--mobile-app-bar-height)+0.5rem)]";
  const desktopBottom = pathname === "/chat" ? "lg:bottom-28" : "lg:bottom-4";
  return (
    <div className={`pointer-events-none fixed inset-x-3 ${mobileBottom} z-[55] flex flex-col items-stretch gap-2 lg:inset-x-auto ${desktopBottom} lg:right-4 lg:w-auto lg:max-w-[20rem]`}>
      <div className="pointer-events-auto flex flex-col gap-2 lg:items-end">
        <ActiveAgentTrayItem />
        <ManualPins />
      </div>
    </div>
  );
}
