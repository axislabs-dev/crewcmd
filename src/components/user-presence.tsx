"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type UserPresenceStatus = "active" | "focus" | "meeting" | "away" | "sleep" | "offline";
type ManualPresenceStatus = Exclude<UserPresenceStatus, "offline">;

interface StatusOption {
  status: ManualPresenceStatus;
  label: string;
  emoji: string;
  expiresInMs: number | null;
}

interface ManualPresence {
  status: ManualPresenceStatus;
  text: string;
  emoji: string;
  expiresAt: number | null;
}

interface PresenceStateInput {
  now: number;
  lastActiveAt: number;
  isVisible: boolean;
  isOnline: boolean;
}

const AWAY_AFTER_MS = 5 * 60 * 1000;
const SLEEP_AFTER_MS = 30 * 60 * 1000;

const STORAGE_KEY = "crewcmd.user-presence";
const FOCUS_DEFAULT_MS = 60 * 60 * 1000;

const statusOptions: StatusOption[] = [
  { status: "active", label: "Active", emoji: "🟢", expiresInMs: null },
  { status: "focus", label: "Focus", emoji: "🎧", expiresInMs: FOCUS_DEFAULT_MS },
  { status: "meeting", label: "In a meeting", emoji: "📅", expiresInMs: 60 * 60 * 1000 },
  { status: "away", label: "Away", emoji: "☕", expiresInMs: 30 * 60 * 1000 },
  { status: "sleep", label: "Sleep", emoji: "🌙", expiresInMs: null },
];

const customDurations = [
  { label: "30m", value: 30 * 60 * 1000 },
  { label: "1h", value: FOCUS_DEFAULT_MS },
  { label: "2h", value: 2 * 60 * 60 * 1000 },
  { label: "Keep", value: null },
];

const presenceMeta: Record<UserPresenceStatus, { label: string; detail: string; dotClass: string; badgeClass: string }> = {
  active: {
    label: "Active",
    detail: "Online and recently active",
    dotClass: "bg-emerald-400 ring-emerald-400/25",
    badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  },
  away: {
    label: "Away",
    detail: "Online, idle for a few minutes",
    dotClass: "bg-amber-300 ring-amber-300/25",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  },
  focus: {
    label: "Focus",
    detail: "Heads-down work",
    dotClass: "bg-violet-300 ring-violet-300/25",
    badgeClass: "border-violet-500/25 bg-violet-500/10 text-violet-200",
  },
  meeting: {
    label: "In a meeting",
    detail: "Calendar or meeting time",
    dotClass: "bg-cyan-300 ring-cyan-300/25",
    badgeClass: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200",
  },
  sleep: {
    label: "Sleep",
    detail: "Online, but inactive or hidden",
    dotClass: "bg-sky-300 ring-sky-300/25",
    badgeClass: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  },
  offline: {
    label: "Offline",
    detail: "Browser is offline",
    dotClass: "bg-[var(--text-tertiary)] ring-[var(--border-medium)]",
    badgeClass: "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]",
  },
};

function readManualPresence(): ManualPresence | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ManualPresence>;
    const option = statusOptions.find((item) => item.status === parsed.status);
    if (!option) return null;
    if (typeof parsed.expiresAt === "number" && parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return {
      status: option.status,
      text: typeof parsed.text === "string" ? parsed.text : option.label,
      emoji: typeof parsed.emoji === "string" ? parsed.emoji : option.emoji,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
    };
  } catch {
    return null;
  }
}

function writeManualPresence(presence: ManualPresence | null) {
  if (!presence) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presence));
}

function formatDuration(ms: number | null) {
  if (ms === null) return "Keep";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatExpiry(expiresAt: number | null) {
  if (!expiresAt) return "doesn't clear";
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  if (minutes < 60) return `clears in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `clears in ${hours}h`;
}

export function resolveUserPresenceStatus({ now, lastActiveAt, isVisible, isOnline }: PresenceStateInput): UserPresenceStatus {
  if (!isOnline) return "offline";
  if (!isVisible) return "sleep";

  const idleFor = now - lastActiveAt;
  if (idleFor >= SLEEP_AFTER_MS) return "sleep";
  if (idleFor >= AWAY_AFTER_MS) return "away";
  return "active";
}

export function useUserPresenceStatus() {
  const [lastActiveAt, setLastActiveAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [isVisible, setIsVisible] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [manualPresence, setManualPresenceState] = useState<ManualPresence | null>(null);

  useEffect(() => {
    const updateActivity = () => {
      const timestamp = Date.now();
      setLastActiveAt(timestamp);
      setNow(timestamp);
    };
    const updateVisibility = () => {
      setIsVisible(document.visibilityState === "visible");
      setNow(Date.now());
    };
    const updateNetwork = () => {
      setIsOnline(navigator.onLine);
      setNow(Date.now());
    };

    updateVisibility();
    updateNetwork();

    const activityEvents = ["pointerdown", "pointermove", "keydown", "focus"] as const;
    activityEvents.forEach((eventName) => window.addEventListener(eventName, updateActivity, { passive: true }));
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);

    const interval = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, updateActivity));
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setManualPresenceState(readManualPresence());

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setManualPresenceState(readManualPresence());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!manualPresence?.expiresAt) return;

    const delay = Math.max(0, manualPresence.expiresAt - Date.now());
    const timeout = window.setTimeout(() => {
      writeManualPresence(null);
      setManualPresenceState(null);
      setNow(Date.now());
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [manualPresence?.expiresAt]);

  const setManualPresence = useCallback((status: ManualPresenceStatus, text?: string, expiresInMs?: number | null) => {
    const option = statusOptions.find((item) => item.status === status);
    if (!option) return;
    const duration = expiresInMs === undefined ? option.expiresInMs : expiresInMs;

    const next = {
      status,
      text: text?.trim() || option.label,
      emoji: option.emoji,
      expiresAt: duration === null ? null : Date.now() + duration,
    };

    writeManualPresence(next);
    setManualPresenceState(next);
    setNow(Date.now());
  }, []);

  const clearManualPresence = useCallback(() => {
    writeManualPresence(null);
    setManualPresenceState(null);
    setNow(Date.now());
  }, []);

  const automaticStatus = resolveUserPresenceStatus({ now, lastActiveAt, isVisible, isOnline });
  const manualIsActive = Boolean(manualPresence && (!manualPresence.expiresAt || manualPresence.expiresAt > now));
  const status = !isOnline ? "offline" : manualIsActive ? manualPresence!.status : automaticStatus;
  const meta = presenceMeta[status];
  const text = manualIsActive ? manualPresence!.text : meta.label;
  const emoji = manualIsActive ? manualPresence!.emoji : null;

  return useMemo(
    () => ({
      status,
      automaticStatus,
      text,
      emoji,
      expiryLabel: manualIsActive ? formatExpiry(manualPresence!.expiresAt) : "automatic",
      isManual: manualIsActive,
      manualPresence,
      options: statusOptions,
      customDurations,
      setManualPresence,
      clearManualPresence,
      ...meta,
    }),
    [automaticStatus, clearManualPresence, emoji, manualIsActive, manualPresence, meta, setManualPresence, status, text]
  );
}

export function UserPresenceDot({ className = "" }: { className?: string }) {
  const presence = useUserPresenceStatus();
  return (
    <span
      title={presence.text}
      aria-label={`Presence: ${presence.text}`}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${presence.dotClass} ${className}`}
    />
  );
}

export function UserPresenceBadge({ className = "" }: { className?: string }) {
  const presence = useUserPresenceStatus();
  return (
    <span
      title={presence.detail}
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${presence.badgeClass} ${className}`}
    >
      <span className={`h-2 w-2 rounded-full ${presence.dotClass}`} />
      {presence.emoji ? `${presence.emoji} ` : null}
      {presence.text}
    </span>
  );
}

export function UserPresenceLine({ className = "" }: { className?: string }) {
  const presence = useUserPresenceStatus();
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] ${className}`} title={presence.detail}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.dotClass}`} />
      <span className="truncate">{presence.emoji ? `${presence.emoji} ` : null}{presence.text}</span>
    </span>
  );
}

export function UserPresenceMenu({ onClose }: { onClose?: () => void }) {
  const presence = useUserPresenceStatus();
  const [customText, setCustomText] = useState(presence.isManual ? presence.text : "");
  const [customDuration, setCustomDuration] = useState<number | null>(FOCUS_DEFAULT_MS);

  return (
    <div className="w-72 rounded-2xl border border-[var(--border-subtle)] bg-white p-3 shadow-2xl shadow-black/25 dark:bg-[#171b20]">
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Set a status</p>
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            Now: {presence.emoji ? `${presence.emoji} ` : null}{presence.text} · {presence.expiryLabel}
          </p>
        </div>
        {presence.isManual ? (
          <button
            type="button"
            onClick={() => {
              presence.clearManualPresence();
              onClose?.();
            }}
            className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-tertiary)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="space-y-1">
        {presence.options.map((option) => (
          <button
            key={option.status}
            type="button"
            onClick={() => {
              presence.setManualPresence(option.status, option.label, option.expiresInMs);
              onClose?.();
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-base">{option.emoji}</span>
              <span className="truncate">{option.label}</span>
            </span>
            <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{formatDuration(option.expiresInMs)}</span>
          </button>
        ))}
      </div>

      <form
        className="mt-3 border-t border-[var(--border-subtle)] pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          presence.setManualPresence("focus", customText, customDuration);
          onClose?.();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.18em] text-[var(--text-tertiary)]">CUSTOM</span>
          <input
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            placeholder="Writing, shipping, reviewing..."
            className="w-full rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {presence.customDurations.map((duration) => (
            <button
              key={duration.label}
              type="button"
              onClick={() => setCustomDuration(duration.value)}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                customDuration === duration.value
                  ? "border-[var(--accent-medium)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border-medium)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {duration.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!customText.trim()}
          className="mt-2 w-full rounded-xl border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:border-[var(--accent)] disabled:opacity-50"
        >
          Set for focus
        </button>
      </form>
    </div>
  );
}
