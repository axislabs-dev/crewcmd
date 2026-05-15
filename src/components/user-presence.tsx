"use client";

import { useEffect, useMemo, useState } from "react";

export type UserPresenceStatus = "active" | "away" | "sleep" | "offline";

interface PresenceStateInput {
  now: number;
  lastActiveAt: number;
  isVisible: boolean;
  isOnline: boolean;
}

const AWAY_AFTER_MS = 5 * 60 * 1000;
const SLEEP_AFTER_MS = 30 * 60 * 1000;

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

  const status = resolveUserPresenceStatus({ now, lastActiveAt, isVisible, isOnline });

  return useMemo(() => ({ status, ...presenceMeta[status] }), [status]);
}

export function UserPresenceDot({ className = "" }: { className?: string }) {
  const presence = useUserPresenceStatus();
  return (
    <span
      title={presence.detail}
      aria-label={`Presence: ${presence.label}`}
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
      {presence.label}
    </span>
  );
}

export function UserPresenceLine({ className = "" }: { className?: string }) {
  const presence = useUserPresenceStatus();
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] ${className}`} title={presence.detail}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.dotClass}`} />
      <span className="truncate">{presence.label}</span>
    </span>
  );
}
