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
import { useWorkspace } from "@/components/company-context";

type AgentVoiceState = "idle" | "listening" | "thinking" | "speaking" | "muted" | "error";
type TrayPinTargetType = "task" | "chat_session" | "chat_thread";

export type ActiveAgentVoiceSession = {
  agentCallsign: string;
  agentName?: string | null;
  agentColor?: string | null;
  sessionKey: string;
  title?: string | null;
  threadSessionKey?: string | null;
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
  systemPinned: boolean;
  userPinned: boolean;
  visible: boolean;
  pins: TrayPin[];
  setActiveSession: (session: ActiveAgentVoiceSession | null) => void;
  setVoiceState: (state: AgentVoiceState) => void;
  setMicMuted: (muted: boolean) => void;
  setAudioMuted: (muted: boolean) => void;
  setIsPlayingAudio: (playing: boolean) => void;
  setUserPinned: (pinned: boolean) => void;
  stopSession: () => void;
  pinTarget: (input: PinTargetInput) => Promise<TrayPin | null>;
  removePin: (id: string) => Promise<void>;
  refreshPins: () => Promise<void>;
};

const AgentVoiceSessionContext = createContext<AgentVoiceSessionContextValue | null>(null);
const INACTIVE_TRAY_GRACE_MS = 30_000;

function activeAgentStorageKey(workspaceId?: string | null, sessionKey?: string | null) {
  return `crewcmd.tray.activeAgentPinned.${workspaceId ?? "global"}.${sessionKey ?? "none"}`;
}

function isActiveState(state: AgentVoiceState) {
  return state === "listening" || state === "thinking" || state === "speaking" || state === "muted";
}

function pinHref(pin: TrayPin) {
  const metadata = pin.metadata ?? {};
  if (pin.targetType === "task") return `/tasks?taskId=${encodeURIComponent(pin.targetId ?? pin.targetKey)}`;
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

export function AgentVoiceSessionProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const [activeSession, setActiveSessionState] = useState<ActiveAgentVoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<AgentVoiceState>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
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
    setVoiceState("idle");
    setIsPlayingAudio(false);
    setMicMuted(false);
    setAudioMuted(false);
    setActiveSessionState(null);
  }, []);

  const value = useMemo<AgentVoiceSessionContextValue>(() => ({
    activeSession,
    voiceState,
    micMuted,
    audioMuted,
    isPlayingAudio,
    systemPinned,
    userPinned,
    visible,
    pins,
    setActiveSession,
    setVoiceState,
    setMicMuted,
    setAudioMuted,
    setIsPlayingAudio,
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
    stopSession,
    systemPinned,
    userPinned,
    visible,
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
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const active = tray.activeSession;
  if (!active || !tray.visible) return null;

  const openChat = () => {
    const params = new URLSearchParams({ sessionKey: active.threadSessionKey ?? active.sessionKey });
    params.set("agent", active.agentCallsign);
    router.push(`/chat?${params.toString()}`);
    setExpanded(false);
  };
  const pinnedLabel = tray.userPinned ? "Unpin active agent" : "Pin active agent";

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 shadow-lg">
        <button type="button" onClick={() => setExpanded(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label="Open active agent controls">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: active.agentColor ?? "var(--accent)" }}>
            {active.agentCallsign.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{active.title || active.agentName || active.agentCallsign}</span>
            <span className="block truncate text-[10px] text-[var(--text-tertiary)]">{tray.voiceState}{tray.isPlayingAudio ? " / audio" : ""}</span>
          </span>
        </button>
        <button type="button" onClick={() => tray.setMicMuted(!tray.micMuted)} className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]" aria-label={tray.micMuted ? "Unmute mic" : "Mute mic"}>
          {tray.micMuted ? "Mic off" : "Mic"}
        </button>
        <button type="button" onClick={() => tray.setAudioMuted(!tray.audioMuted)} className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]" aria-label={tray.audioMuted ? "Unmute audio" : "Mute audio"}>
          {tray.audioMuted ? "Audio off" : "Audio"}
        </button>
        <button type="button" onClick={() => tray.setUserPinned(!tray.userPinned)} className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]" aria-label={pinnedLabel} title={pinnedLabel}>
          {tray.userPinned ? "Pinned" : "Pin"}
        </button>
        <button type="button" onClick={tray.stopSession} className="rounded-md px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--bg-surface-hover)]" aria-label="Stop active agent">
          Stop
        </button>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[75] flex items-end bg-black/30 lg:items-center lg:justify-end" onClick={() => setExpanded(false)}>
          <div className="w-full rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-2xl lg:mr-6 lg:max-w-sm lg:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{active.title || active.agentName || active.agentCallsign}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{tray.voiceState}{tray.systemPinned ? " / active" : " / recent"}</div>
              </div>
              <button type="button" onClick={() => setExpanded(false)} className="rounded-md px-2 py-1 text-sm text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Close active agent sheet">
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => tray.setMicMuted(!tray.micMuted)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">{tray.micMuted ? "Unmute mic" : "Mute mic"}</button>
              <button type="button" onClick={() => tray.setAudioMuted(!tray.audioMuted)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">{tray.audioMuted ? "Unmute audio" : "Mute audio"}</button>
              <button type="button" onClick={() => tray.setUserPinned(!tray.userPinned)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)]">{tray.userPinned ? "Unpin" : "Pin"}</button>
              <button type="button" onClick={tray.stopSession} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--danger)]">Stop</button>
            </div>
            <button type="button" onClick={openChat} className="mt-3 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white">
              Open chat
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ManualPins() {
  const { pins, removePin } = useAgentVoiceSession();
  if (pins.length === 0) return null;
  return (
    <div className="flex min-w-0 gap-2 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2 shadow-lg">
      {pins.map((pin) => (
        <div key={pin.id} className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-surface)] px-2 py-1">
          <Link href={pinHref(pin)} className="max-w-40 truncate text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {pin.targetType === "task" ? "Task" : "Chat"} / {pin.title}
          </Link>
          <button type="button" onClick={() => void removePin(pin.id)} className="rounded px-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label={`Remove ${pin.title} from tray`}>
            x
          </button>
        </div>
      ))}
    </div>
  );
}

export function AppTray() {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/access-denied" || pathname.startsWith("/invite/")) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--mobile-app-bar-height)+0.5rem)] z-[55] flex flex-col items-stretch gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[min(34rem,calc(100vw-7rem))]">
      <div className="pointer-events-auto flex flex-col gap-2 lg:items-end">
        <ActiveAgentTrayItem />
        <ManualPins />
      </div>
    </div>
  );
}
