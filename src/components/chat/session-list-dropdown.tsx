"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import {
  useSessionBrowserStore,
  type SessionBrowserEntry,
} from "@/lib/session-browser-store";

// ---------- kind badge helpers ----------

const kindBadges: Record<string, { bg: string; text: string; label: string }> = {
  direct: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "direct" },
  cron: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "cron" },
  slack: { bg: "bg-purple-500/20", text: "text-purple-400", label: "slack" },
  telegram: { bg: "bg-blue-500/20", text: "text-blue-400", label: "telegram" },
  deliver: { bg: "bg-green-500/20", text: "text-green-400", label: "deliver" },
  global: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "global" },
  group: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "group" },
};

function kindBadge(kind: string) {
  const m = kindBadges[kind] ?? { bg: "bg-zinc-500/20", text: "text-zinc-400", label: kind };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-px text-[9px] font-mono tracking-wider ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}

// ---------- time formatting ----------

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts * 1000; // gateway may use seconds
  const ms = diff > 1e12 ? diff : diff * 1000; // heuristic: treat >1e12 as ms
  const ago = Date.now() - (diff > 1e12 ? ts * 1000 : ts * 1000);
  const secs = Math.floor(ago / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------- individual session row ----------

interface SessionRowProps {
  entry: SessionBrowserEntry;
  depth?: number;
  isSelected: boolean;
  onSelect: (key: string) => void;
}

function SessionRow({ entry, depth = 0, isSelected, onSelect }: SessionRowProps) {
  const getAgentInfo = useSessionBrowserStore((s) => s.getAgentInfo);
  const info = getAgentInfo(entry.agentId);

  const displayText = entry.title || entry.lastMessagePreview;

  return (
    <button
      onClick={() => onSelect(entry.key)}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--bg-surface-hover)] ${
        isSelected
          ? "border-l-2 border-l-[var(--accent)] bg-[var(--bg-surface-hover)]"
          : ""
      }`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
    >
      {depth > 0 && (
        <span className="text-[var(--text-tertiary)] shrink-0">└─</span>
      )}

      {/* Emoji + agent callsign */}
      <span className="text-base shrink-0">{info.emoji}</span>
      <span className="font-mono tracking-wider text-[var(--text-secondary)] shrink-0" style={{ color: info.color }}>
        {entry.key}
      </span>

      {/* Title / preview */}
      {displayText && (
        <span className="truncate text-[var(--text-tertiary)]">
          {displayText}
        </span>
      )}

      {/* Time + badge */}
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        {entry.updatedAt && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {timeAgo(entry.updatedAt)}
          </span>
        )}
        {kindBadge(entry.kind)}
      </div>
    </button>
  );
}

// ---------- main dropdown component ----------

interface SessionListDropdownProps {
  onSelectSession: (key: string) => void;
  selectedAgentCallsign: string | null;
}

export function SessionListDropdown({ onSelectSession, selectedAgentCallsign }: SessionListDropdownProps) {
  const sessions = useSessionBrowserStore((s) => s.sessions);
  const isLoading = useSessionBrowserStore((s) => s.isLoading);
  const error = useSessionBrowserStore((s) => s.error);
  const selectedSessionKey = useSessionBrowserStore((s) => s.selectedSessionKey);
  const fetchSessions = useSessionBrowserStore((s) => s.fetchSessions);
  const getTree = useSessionBrowserStore((s) => s.getTree);
  const getChildren = useSessionBrowserStore((s) => s.getChildren);
  const selectSession = useSessionBrowserStore((s) => s.selectSession);
  const lastFetched = useSessionBrowserStore((s) => s.lastFetched);

  // Ref for debounce
  const fetchRef = useRef(false);

  const fetch = useCallback(() => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    fetchSessions().then(() => {
      fetchRef.current = false;
    }).catch(() => {
      fetchRef.current = false;
    });
  }, [fetchSessions]);

  // Fetch on mount + every 60s if stale
  useEffect(() => {
    fetch();
    const interval = setInterval(() => {
      if (!lastFetched || Date.now() - lastFetched > 60_000) {
        fetch();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => getTree(), [getTree, sessions]);

  const handleSelect = useCallback(
    (key: string) => {
      selectSession(key);
      onSelectSession(key);
    },
    [selectSession, onSelectSession]
  );

  return (
    <div>
      {/* Loading state */}
      {isLoading && sessions.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-4">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
          <span className="text-[11px] text-[var(--text-tertiary)]">Loading sessions…</span>
        </div>
      )}

      {/* Error state */}
      {error && sessions.length === 0 && (
        <div className="px-3 py-4 text-center">
          <div className="text-[11px] text-red-400">Failed to load sessions</div>
          <button
            onClick={fetch}
            className="mt-1 text-[10px] text-[var(--accent)] underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Session tree */}
      {sessions.length > 0 && (
        <div>
          {tree.map(({ session, children }) => (
            <div key={session.key}>
              {/* Root session (depth 0 — no indent marker) */}
              <SessionRow
                entry={session}
                depth={0}
                isSelected={selectedSessionKey === session.key}
                onSelect={handleSelect}
              />
              {/* Child sessions */}
              {children.length > 0 &&
                children.map((child) => (
                  <SessionRow
                    key={child.key}
                    entry={child}
                    depth={1}
                    isSelected={selectedSessionKey === child.key}
                    onSelect={handleSelect}
                  />
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sessions.length === 0 && !error && (
        <div className="px-3 py-4 text-center">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            No sessions available
          </span>
        </div>
      )}
    </div>
  );
}
