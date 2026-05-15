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
import { stopNativeVoiceAudio } from "@/lib/native-voice-session";

type AgentVoiceState = "idle" | "ready" | "listening" | "hearing" | "processing" | "thinking" | "speaking" | "muted" | "paused" | "error";
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
  return state === "ready" || state === "listening" || state === "hearing" || state === "processing" || state === "thinking" || state === "speaking" || state === "muted";
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
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const active = tray.activeSession;
  if (!active || !tray.visible) return null;
  if (pathname === "/chat" && !expanded) return null;

  const openChat = () => {
    const params = new URLSearchParams({ sessionKey: active.threadSessionKey ?? active.sessionKey });
    params.set("agent", active.agentCallsign);
    router.push(`/chat?${params.toString()}`);
    setExpanded(false);
  };
  const pinnedLabel = tray.userPinned ? "Unpin active agent" : "Pin active agent";
  const stateTone = tray.voiceState === "speaking"
    ? "var(--accent)"
    : tray.voiceState === "error" || tray.voiceState === "paused"
      ? "var(--danger)"
      : tray.voiceState === "ready"
        ? "var(--text-tertiary)"
        : active.agentColor ?? "var(--accent)";

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-white shadow-2xl transition hover:scale-[1.02]"
        aria-label="Open active agent bubble"
        title={`${active.title || active.agentName || active.agentCallsign}: ${tray.voiceState}`}
      >
        <span className="absolute inset-0 rounded-full border-2 opacity-70" style={{ borderColor: stateTone }} />
        <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: active.agentColor ?? "var(--accent)" }}>
            {active.agentCallsign.slice(0, 2).toUpperCase()}
        </span>
        {(tray.voiceState === "listening" || tray.voiceState === "hearing" || tray.voiceState === "speaking") ? (
          <span className="absolute -bottom-0.5 flex h-4 items-end gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5" aria-hidden="true">
            <span className="h-1.5 w-0.5 rounded-full bg-[var(--accent)]" />
            <span className="h-2.5 w-0.5 rounded-full bg-[var(--accent)]" />
            <span className="h-1 w-0.5 rounded-full bg-[var(--accent)]" />
          </span>
        ) : null}
      </button>

      {expanded && (
        <div className="fixed inset-0 z-[75] flex items-end bg-black/30 lg:items-center lg:justify-end" onClick={() => setExpanded(false)}>
          <div className="w-full rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-2xl lg:mr-6 lg:max-w-sm lg:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{active.title || active.agentName || active.agentCallsign}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{tray.voiceState}{tray.systemPinned ? " / active" : " / recent"}</div>
              </div>
              <button type="button" onClick={() => setExpanded(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Close active agent sheet" title="Close">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
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
            <button type="button" onClick={openChat} className="mt-3 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white">
              Open chat
            </button>
          </div>
        </div>
      )}
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
  const { pins, removePin } = useAgentVoiceSession();
  const [expanded, setExpanded] = useState(false);
  if (pins.length === 0) return null;
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ml-auto flex h-12 min-w-12 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[var(--text-primary)] shadow-2xl transition hover:scale-[1.02]"
        aria-label={`Open ${pins.length} tray pin${pins.length === 1 ? "" : "s"}`}
        title={`${pins.length} pinned item${pins.length === 1 ? "" : "s"}`}
      >
        <span className="flex -space-x-2">
          {pins.slice(0, 3).map((pin) => (
            <span
              key={pin.id}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--bg-elevated)] bg-[var(--bg-surface-hover)] text-[10px] font-bold uppercase text-[var(--text-secondary)]"
            >
              {pin.targetType === "task" ? "T" : "C"}
            </span>
          ))}
        </span>
        {pins.length > 3 ? <span className="ml-1 text-[10px] font-semibold text-[var(--text-tertiary)]">+{pins.length - 3}</span> : null}
      </button>
    );
  }
  return (
    <div className="flex min-w-0 gap-2 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2 shadow-lg">
      {pins.map((pin) => (
        <div key={pin.id} className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-surface)] px-2 py-1">
          <Link href={pinHref(pin)} onClick={() => setExpanded(false)} className="max-w-40 truncate text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {pin.targetType === "task" ? "Task" : "Chat"} / {pin.title}
          </Link>
          <button type="button" onClick={() => void removePin(pin.id)} className="rounded px-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label={`Remove ${pin.title} from tray`}>
            x
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setExpanded(false)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]" aria-label="Collapse tray pins" title="Collapse">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
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
