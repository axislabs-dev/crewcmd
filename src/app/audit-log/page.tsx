"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEntry {
  id: string;
  companyId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  created: "text-emerald-400 bg-emerald-500/10",
  updated: "text-blue-400 bg-blue-500/10",
  deleted: "text-red-400 bg-red-500/10",
  approved: "text-emerald-400 bg-emerald-500/10",
  rejected: "text-red-400 bg-red-500/10",
  delegated: "text-purple-400 bg-purple-500/10",
  escalated: "text-amber-400 bg-amber-500/10",
  rolled_back: "text-amber-400 bg-amber-500/10",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [filterActor, setFilterActor] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntityType, setFilterEntityType] = useState("");
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const params = new URLSearchParams({ company_id: cId });
      if (filterActor) params.set("actor", filterActor);
      if (filterAction) params.set("action", filterAction);
      if (filterEntityType) params.set("entity_type", filterEntityType);

      const res = await fetch(`/api/audit-log?${params.toString()}`);
      if (res.ok) setEntries(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterActor, filterAction, filterEntityType]);

  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("active_company="));
    const cId = cookie?.split("=")[1] ?? null;
    setCompanyId(cId);
    if (cId) fetchData(cId);
    else setLoading(false);
  }, [fetchData]);

  // Extract unique values for filter dropdowns
  const uniqueActors = [...new Set(entries.map((e) => e.actor))];
  const uniqueActions = [...new Set(entries.map((e) => e.action))];
  const uniqueEntityTypes = [...new Set(entries.map((e) => e.entityType))];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="font-mono text-sm text-white/30">Loading...</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-sm text-white/40">No company selected</p>
          <p className="mt-1 font-mono text-xs text-white/25">
            Select a company from the sidebar to view the audit log.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div>
        <h1 className="font-mono text-lg font-bold tracking-wider text-neo">AUDIT LOG</h1>
        <p className="mt-1 font-mono text-xs text-white/30">
          Immutable record of all governance actions
        </p>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3">
        <select
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] text-white/50 outline-none"
        >
          <option value="">All actors</option>
          {uniqueActors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] text-white/50 outline-none"
        >
          <option value="">All actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={filterEntityType}
          onChange={(e) => setFilterEntityType(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] text-white/50 outline-none"
        >
          <option value="">All entity types</option>
          {uniqueEntityTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {(filterActor || filterAction || filterEntityType) && (
          <button
            onClick={() => {
              setFilterActor("");
              setFilterAction("");
              setFilterEntityType("");
            }}
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 font-mono text-[10px] text-white/25 hover:text-white/40"
          >
            CLEAR
          </button>
        )}
      </div>

      {/* Entries */}
      <div className="mt-4 space-y-1">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] py-16 text-center">
            <p className="font-mono text-xs text-white/30">No audit entries</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-white/[0.04] bg-white/[0.01] transition-colors hover:border-white/[0.06]"
            >
              <button
                onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[8px] tracking-wider ${
                    ACTION_COLORS[entry.action] ?? "text-white/30 bg-white/5"
                  }`}
                >
                  {entry.action.toUpperCase()}
                </span>
                <span className="font-mono text-[10px] text-white/50">
                  {entry.actor}
                </span>
                <span className="font-mono text-[10px] text-white/20">
                  {entry.entityType}/{entry.entityId.substring(0, 8)}
                </span>
                <span className="ml-auto font-mono text-[9px] text-white/15">
                  {formatDate(entry.createdAt)}
                </span>
                <svg
                  className={`h-3 w-3 text-white/15 transition-transform ${
                    expandedEntry === entry.id ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {expandedEntry === entry.id && entry.details && (
                <div className="border-t border-white/[0.04] px-3 pb-3 pt-2">
                  <pre className="max-h-48 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] text-white/40">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Count */}
      <div className="mt-4 text-right">
        <span className="font-mono text-[9px] text-white/15">
          {entries.length} entries shown (max 500)
        </span>
      </div>
    </div>
  );
}
