// SIDEBAR: Add 'Inbox' to top-level nav (before Dashboard) with an inbox/tray SVG icon
// href: '/inbox', label: 'Inbox'
// Icon SVG suggestion:
// <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
//   <path d="M1 8.82L1 14a2 2 0 002 2h14a2 2 0 002-2V8.82l-3.45-5.17A2 2 0 0013.89 2H6.11a2 2 0 00-1.66.88L1 8.82z" />
//   <path d="M1 8h5.5a1 1 0 011 1v.5a1.5 1.5 0 003 0V9a1 1 0 011-1H18" fill="none" stroke="currentColor" strokeWidth="1.5" />
// </svg>

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  InboxMessage,
  InboxMessageType,
  InboxPriority,
  InboxStatus,
  InboxAction,
  InboxStats,
} from "@/db/schema-inbox";
import { timeAgo } from "@/lib/utils";

// ─── Constants ─────────────────────────────────────────────────────────

/** Agent emoji/color lookup for seed agents */
const AGENT_META: Record<string, { emoji: string; name: string; color: string }> = {
  FORGE: { emoji: "\u{1F525}", name: "Forge", color: "#ff6600" },
  CIPHER: { emoji: "\u{1F510}", name: "Cipher", color: "#00f0ff" },
  PULSE: { emoji: "\u{1F49A}", name: "Pulse", color: "#00ff88" },
  RAZOR: { emoji: "\u{1FA92}", name: "Razor", color: "#ff00aa" },
  HAVOC: { emoji: "\u26A1", name: "Havoc", color: "#f0ff00" },
};

const TYPE_STYLES: Record<InboxMessageType, { label: string; color: string; bg: string; border: string }> = {
  decision: { label: "DECISION", color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30" },
  blocker: { label: "BLOCKER", color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" },
  question: { label: "QUESTION", color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  completed: { label: "COMPLETED", color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" },
  escalation: { label: "ESCALATION", color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/30" },
  update: { label: "UPDATE", color: "text-white/50", bg: "bg-white/[0.04]", border: "border-white/[0.08]" },
  approval: { label: "APPROVAL", color: "text-[#00f0ff]", bg: "bg-[#00f0ff]/10", border: "border-[#00f0ff]/30" },
};

const PRIORITY_BORDER: Record<InboxPriority, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-400",
  normal: "border-l-[#00f0ff]",
  low: "border-l-white/20",
};

const PRIORITY_LABEL: Record<InboxPriority, { label: string; color: string; dot: string }> = {
  critical: { label: "CRITICAL", color: "text-red-400", dot: "bg-red-500" },
  high: { label: "HIGH", color: "text-orange-400", dot: "bg-orange-400" },
  normal: { label: "NORMAL", color: "text-[#00f0ff]", dot: "bg-[#00f0ff]" },
  low: { label: "LOW", color: "text-white/40", dot: "bg-white/40" },
};

type TypeFilter = "all" | InboxMessageType;
type PriorityFilter = "all" | InboxPriority;
type StatusFilter = "unread" | "all" | "snoozed";

// ─── Helper Components ────────────────────────────────────────────────

function TypeBadge({ type }: { type: InboxMessageType }) {
  const s = TYPE_STYLES[type];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] tracking-wider border ${s.color} ${s.bg} ${s.border}`}>
      {s.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: InboxPriority }) {
  const p = PRIORITY_LABEL[priority];
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-wider ${p.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

function AgentTag({ callsign }: { callsign: string }) {
  const meta = AGENT_META[callsign] || { emoji: "\u{1F916}", name: callsign, color: "#888" };
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-white/70">
      <span>{meta.emoji}</span>
      <span style={{ color: meta.color }}>{callsign}</span>
    </span>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────

/** Agent Inbox — centralized communication hub for agent-human interactions */
export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionedMap, setActionedMap] = useState<Record<string, string>>({});

  // Filters
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unread");

  const listRef = useRef<HTMLDivElement>(null);

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  // ── Fetch messages ──────────────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/inbox?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      }
    } catch {
      /* network error — keep existing messages */
    }
  }, [statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/stats");
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMessages(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchMessages, fetchStats]);

  // Poll stats every 30s
  useEffect(() => {
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // ── Keyboard navigation ─────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const filtered = filteredMessages;
      const idx = filtered.findIndex((m) => m.id === selectedId);

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = idx < filtered.length - 1 ? idx + 1 : 0;
        setSelectedId(filtered[next]?.id ?? null);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : filtered.length - 1;
        setSelectedId(filtered[prev]?.id ?? null);
      } else if (e.key === "r" && selected && selected.status === "unread") {
        e.preventDefault();
        handleAction(selected.id, "read", "mark_read");
      } else if (e.key === "e" && selected) {
        e.preventDefault();
        handleAction(selected.id, "dismissed", "dismiss");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, messages, typeFilter, priorityFilter]);

  // ── Actions ─────────────────────────────────────────────────────────

  async function handleAction(messageId: string, status: InboxStatus | string, actionResult: string) {
    setActioningId(messageId);
    try {
      const res = await fetch(`/api/inbox/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actionResult }),
      });
      if (res.ok) {
        setActionedMap((prev) => ({ ...prev, [messageId]: actionResult }));
        // Update local state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, status: status as InboxStatus, actionResult }
              : m
          )
        );
        fetchStats();
      }
    } catch {
      /* ignore */
    } finally {
      setActioningId(null);
    }
  }

  async function handleButtonAction(messageId: string, action: InboxAction) {
    if (action.action === "snooze") {
      const snoozeUntil = new Date(Date.now() + 60 * 60_000).toISOString(); // 1 hour
      await handleAction(messageId, "snoozed", action.label);
      // Also set snooze time
      await fetch(`/api/inbox/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozeUntil }),
      });
    } else if (action.action === "dismiss") {
      await handleAction(messageId, "dismissed", action.label);
    } else {
      await handleAction(messageId, "actioned", action.label);
    }
  }

  // ── Filtering ───────────────────────────────────────────────────────

  const filteredMessages = messages.filter((m) => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (priorityFilter !== "all" && m.priority !== priorityFilter) return false;
    return true;
  });

  // Auto-select first message
  useEffect(() => {
    if (!selectedId && filteredMessages.length > 0) {
      setSelectedId(filteredMessages[0].id);
    }
  }, [filteredMessages, selectedId]);

  // ── Render ──────────────────────────────────────────────────────────

  const typeFilters: { value: TypeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "decision", label: "Decisions" },
    { value: "blocker", label: "Blockers" },
    { value: "question", label: "Questions" },
    { value: "completed", label: "Completed" },
    { value: "escalation", label: "Escalations" },
    { value: "approval", label: "Approvals" },
  ];

  const priorityFilters: { value: PriorityFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "normal", label: "Normal" },
  ];

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: "unread", label: "Unread" },
    { value: "all", label: "All" },
    { value: "snoozed", label: "Snoozed" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-0 p-4 sm:p-6">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="mb-4 space-y-3">
          {/* Title + stats bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-lg font-bold tracking-wider text-white">
                INBOX
              </h1>
              {stats && stats.total > 0 && (
                <span className="inline-flex items-center rounded-full bg-[#00f0ff]/15 px-2.5 py-0.5 font-mono text-xs font-bold text-[#00f0ff] shadow-[0_0_8px_rgba(0,240,255,0.3)]">
                  {stats.total}
                </span>
              )}
            </div>

            {/* Stats counters */}
            {stats && stats.total > 0 && (
              <div className="hidden items-center gap-4 font-mono text-[11px] tracking-wider sm:flex">
                {stats.byPriority.critical > 0 && (
                  <span className="flex items-center gap-1.5 text-red-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                    {stats.byPriority.critical} CRITICAL
                  </span>
                )}
                {stats.byPriority.high > 0 && (
                  <span className="flex items-center gap-1.5 text-orange-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    {stats.byPriority.high} HIGH
                  </span>
                )}
                {stats.byPriority.normal > 0 && (
                  <span className="flex items-center gap-1.5 text-[#00f0ff]/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#00f0ff]" />
                    {stats.byPriority.normal} NORMAL
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Type filters */}
            <div className="flex items-center gap-1">
              {typeFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] tracking-wider transition-colors ${
                    typeFilter === f.value
                      ? "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30"
                      : "text-white/40 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <span className="text-white/[0.08]">|</span>

            {/* Priority filters */}
            <div className="flex items-center gap-1">
              {priorityFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setPriorityFilter(f.value)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] tracking-wider transition-colors ${
                    priorityFilter === f.value
                      ? "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30"
                      : "text-white/40 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <span className="text-white/[0.08]">|</span>

            {/* Status toggle */}
            <div className="flex items-center gap-1">
              {statusFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => { setStatusFilter(f.value); setSelectedId(null); }}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] tracking-wider transition-colors ${
                    statusFilter === f.value
                      ? "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30"
                      : "text-white/40 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Loading state ────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 font-mono text-sm text-white/40">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              LOADING INBOX...
            </div>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {!loading && filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-[#00f0ff]/20 bg-[#00f0ff]/5">
              <svg className="h-7 w-7 text-[#00f0ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="font-mono text-sm font-bold tracking-wider text-white/60">ALL CLEAR</p>
            <p className="mt-1 font-mono text-[11px] text-white/35">No messages match your filters</p>
          </div>
        )}

        {/* ── Split panel ──────────────────────────────────────────── */}
        {!loading && filteredMessages.length > 0 && (
          <div className="flex gap-0 overflow-hidden rounded-lg border border-white/[0.06]" style={{ height: "calc(100vh - 220px)" }}>
            {/* ── Message List (left) ─────────────────────────────── */}
            <div
              ref={listRef}
              className="w-[450px] min-w-[320px] flex-shrink-0 overflow-y-auto border-r border-white/[0.06] bg-white/[0.01]"
            >
              {filteredMessages.map((msg) => {
                const isSelected = msg.id === selectedId;
                const isActioned = !!actionedMap[msg.id];
                const isUnread = msg.status === "unread";

                return (
                  <button
                    key={msg.id}
                    onClick={() => setSelectedId(msg.id)}
                    className={`w-full text-left border-l-[3px] border-b border-b-white/[0.04] px-3 py-3 transition-colors ${
                      PRIORITY_BORDER[msg.priority]
                    } ${
                      isSelected
                        ? "bg-white/[0.06]"
                        : isUnread
                        ? "bg-white/[0.02] hover:bg-white/[0.04]"
                        : "bg-transparent hover:bg-white/[0.03]"
                    } ${isActioned ? "opacity-50" : ""}`}
                  >
                    {/* Row 1: agent + type + time */}
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <AgentTag callsign={msg.fromAgentId} />
                        <TypeBadge type={msg.type} />
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.5)]" />
                        )}
                        <span className="font-mono text-[10px] text-white/35">
                          {timeAgo(msg.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: title */}
                    <p className={`truncate font-mono text-[12px] leading-snug ${isUnread ? "font-semibold text-white" : "text-white/70"}`}>
                      {msg.title}
                    </p>

                    {/* Row 3: body preview */}
                    <p className="mt-0.5 line-clamp-2 font-mono text-[11px] leading-relaxed text-white/35">
                      {msg.body.replace(/[*#`_~\[\]]/g, "").slice(0, 120)}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* ── Detail Panel (right) ────────────────────────────── */}
            <div className="flex-1 overflow-y-auto bg-[#0a0e14] p-6">
              {!selected ? (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-sm text-white/35">Select a message</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Header */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AgentTag callsign={selected.fromAgentId} />
                      <TypeBadge type={selected.type} />
                      <PriorityBadge priority={selected.priority} />
                      <span className="ml-auto font-mono text-[11px] text-white/35">
                        {new Date(selected.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <h2 className="font-mono text-base font-bold text-white leading-snug">
                      {selected.title}
                    </h2>
                  </div>

                  {/* Body */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-white/70">
                      {selected.body}
                    </div>
                  </div>

                  {/* Context links */}
                  {selected.context && (
                    <div className="flex items-center gap-3">
                      {selected.context.taskId && (
                        <a
                          href={`/tasks`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-white/50 hover:text-[#00f0ff] hover:border-[#00f0ff]/30 transition-colors"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 12l2 2 4-4" />
                          </svg>
                          Task {selected.context.taskId}
                        </a>
                      )}
                      {selected.context.projectId && (
                        <a
                          href={`/projects`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-white/50 hover:text-[#00f0ff] hover:border-[#00f0ff]/30 transition-colors"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          Project {selected.context.projectId}
                        </a>
                      )}
                      {selected.context.relatedAgents && selected.context.relatedAgents.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-white/35 tracking-wider">RELATED:</span>
                          {selected.context.relatedAgents.map((a) => (
                            <AgentTag key={a} callsign={a} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  {actionedMap[selected.id] ? (
                    <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
                      <svg className="h-4 w-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="font-mono text-[12px] text-green-400">
                        Action taken: <span className="font-bold">{actionedMap[selected.id]}</span>
                      </span>
                    </div>
                  ) : selected.actions && selected.actions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {selected.actions.map((action) => (
                        <button
                          key={action.id}
                          disabled={actioningId === selected.id}
                          onClick={() => handleButtonAction(selected.id, action)}
                          className={`rounded-md px-4 py-2 font-mono text-[12px] font-bold tracking-wider transition-all disabled:opacity-50 ${
                            action.style === "primary"
                              ? "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30 hover:bg-[#00f0ff]/25 shadow-[0_0_8px_rgba(0,240,255,0.15)]"
                              : action.style === "danger"
                              ? "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                              : "bg-transparent text-white/50 border border-white/[0.08] hover:bg-white/[0.04] hover:text-white/70"
                          }`}
                        >
                          {actioningId === selected.id ? (
                            <svg className="mx-2 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                              <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          ) : (
                            action.label
                          )}
                        </button>
                      ))}

                      {/* Quick actions */}
                      <span className="mx-1 text-white/[0.08]">|</span>
                      {selected.status === "unread" && (
                        <button
                          onClick={() => handleAction(selected.id, "read", "mark_read")}
                          className="rounded-md px-3 py-2 font-mono text-[11px] text-white/35 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                          title="Mark as read (r)"
                        >
                          Mark Read
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(selected.id, "dismissed", "dismiss")}
                        className="rounded-md px-3 py-2 font-mono text-[11px] text-white/35 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                        title="Dismiss (e)"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {selected.status === "unread" && (
                        <button
                          onClick={() => handleAction(selected.id, "read", "mark_read")}
                          className="rounded-md border border-white/[0.08] px-4 py-2 font-mono text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors"
                        >
                          Mark Read
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(selected.id, "dismissed", "dismiss")}
                        className="rounded-md border border-white/[0.08] px-4 py-2 font-mono text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Keyboard hints */}
                  <div className="flex items-center gap-4 border-t border-white/[0.04] pt-3">
                    <span className="font-mono text-[10px] text-white/25 tracking-wider">
                      <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-[9px]">&uarr;</kbd>
                      <kbd className="ml-0.5 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-[9px]">&darr;</kbd>
                      {" "}navigate
                    </span>
                    <span className="font-mono text-[10px] text-white/25 tracking-wider">
                      <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-[9px]">r</kbd>
                      {" "}mark read
                    </span>
                    <span className="font-mono text-[10px] text-white/25 tracking-wider">
                      <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-[9px]">e</kbd>
                      {" "}dismiss
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
