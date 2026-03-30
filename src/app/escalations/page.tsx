"use client";

import { useState, useEffect, useCallback } from "react";

interface EscalationPath {
  id: string;
  companyId: string;
  triggerType: string;
  sourceAgentId: string | null;
  escalateToAgentId: string | null;
  escalateToUserId: string | null;
  timeoutMinutes: number;
  autoEscalate: boolean;
  createdAt: string;
}

interface ApprovalRequest {
  id: string;
  requestType: string;
  requestedBy: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

const TRIGGER_TYPES = [
  "blocked_task",
  "budget_exceeded",
  "heartbeat_failed",
  "approval_timeout",
  "agent_offline",
] as const;

const TRIGGER_LABELS: Record<string, string> = {
  blocked_task: "Blocked Task",
  budget_exceeded: "Budget Exceeded",
  heartbeat_failed: "Heartbeat Failed",
  approval_timeout: "Approval Timeout",
  agent_offline: "Agent Offline",
};

const TRIGGER_COLORS: Record<string, string> = {
  blocked_task: "bg-amber-500/10 text-amber-400",
  budget_exceeded: "bg-red-500/10 text-red-400",
  heartbeat_failed: "bg-purple-500/10 text-purple-400",
  approval_timeout: "bg-orange-500/10 text-orange-400",
  agent_offline: "bg-slate-500/10 text-slate-400",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function EscalationsPage() {
  const [tab, setTab] = useState<"paths" | "active">("paths");
  const [paths, setPaths] = useState<EscalationPath[]>([]);
  const [activeEscalations, setActiveEscalations] = useState<ApprovalRequest[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editPath, setEditPath] = useState<EscalationPath | null>(null);
  const [formTriggerType, setFormTriggerType] = useState<string>("");
  const [formSourceAgentId, setFormSourceAgentId] = useState("");
  const [formEscalateToAgentId, setFormEscalateToAgentId] = useState("");
  const [formTimeoutMinutes, setFormTimeoutMinutes] = useState(60);
  const [formAutoEscalate, setFormAutoEscalate] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [pathsRes, escalationsRes, agentsRes] = await Promise.all([
        fetch(`/api/escalation-paths?company_id=${cId}`),
        fetch(`/api/approval-requests?company_id=${cId}&status=pending`),
        fetch("/api/agents"),
      ]);
      if (pathsRes.ok) setPaths(await pathsRes.json());
      if (escalationsRes.ok) {
        const all: ApprovalRequest[] = await escalationsRes.json();
        setActiveEscalations(all.filter((r) => r.requestType.startsWith("escalation:")));
      }
      if (agentsRes.ok) setAgents(await agentsRes.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("active_company="));
    const cId = cookie?.split("=")[1] ?? null;
    setCompanyId(cId);
    if (cId) fetchData(cId);
    else setLoading(false);
  }, [fetchData]);

  function getAgentName(callsign: string): string {
    const agent = agents.find((a) => a.callsign === callsign);
    return agent ? `${agent.emoji} ${agent.name}` : callsign;
  }

  function openCreate() {
    setEditPath(null);
    setFormTriggerType("");
    setFormSourceAgentId("");
    setFormEscalateToAgentId("");
    setFormTimeoutMinutes(60);
    setFormAutoEscalate(true);
    setShowModal(true);
  }

  function openEdit(path: EscalationPath) {
    setEditPath(path);
    setFormTriggerType(path.triggerType);
    setFormSourceAgentId(path.sourceAgentId ?? "");
    setFormEscalateToAgentId(path.escalateToAgentId ?? "");
    setFormTimeoutMinutes(path.timeoutMinutes);
    setFormAutoEscalate(path.autoEscalate);
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formTriggerType) return;
    setSaving(true);
    try {
      if (editPath) {
        await fetch(`/api/escalation-paths/${editPath.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            triggerType: formTriggerType,
            sourceAgentId: formSourceAgentId || null,
            escalateToAgentId: formEscalateToAgentId || null,
            timeoutMinutes: formTimeoutMinutes,
            autoEscalate: formAutoEscalate,
          }),
        });
      } else {
        await fetch("/api/escalation-paths", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            triggerType: formTriggerType,
            sourceAgentId: formSourceAgentId || null,
            escalateToAgentId: formEscalateToAgentId || null,
            timeoutMinutes: formTimeoutMinutes,
            autoEscalate: formAutoEscalate,
          }),
        });
      }
      setShowModal(false);
      fetchData(companyId);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/escalation-paths/${id}`, { method: "DELETE" });
    if (companyId) fetchData(companyId);
  }

  async function handleToggleAutoEscalate(path: EscalationPath) {
    await fetch(`/api/escalation-paths/${path.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoEscalate: !path.autoEscalate }),
    });
    if (companyId) fetchData(companyId);
  }

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
            Select a company from the sidebar to manage escalation paths.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-wider text-neo">ESCALATIONS</h1>
          <p className="mt-1 font-mono text-xs text-white/30">
            Escalation paths &amp; active escalations
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg bg-white/[0.02] p-1">
        <button
          onClick={() => setTab("paths")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "paths" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          ESCALATION PATHS
        </button>
        <button
          onClick={() => setTab("active")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "active" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          ACTIVE ESCALATIONS
          {activeEscalations.length > 0 && (
            <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] text-red-400">
              {activeEscalations.length}
            </span>
          )}
        </button>
      </div>

      {/* Paths Tab */}
      {tab === "paths" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
              CONFIGURED PATHS
            </h2>
            <button
              onClick={openCreate}
              className="rounded-lg bg-neo/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-neo transition-colors hover:bg-neo/30"
            >
              + ADD PATH
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {paths.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.08] py-12 text-center">
                <p className="font-mono text-xs text-white/30">No escalation paths configured</p>
                <p className="mt-1 font-mono text-[10px] text-white/20">
                  Paths define how issues get escalated to managers or humans.
                </p>
              </div>
            ) : (
              paths.map((path) => (
                <div
                  key={path.id}
                  className="group flex items-center gap-4 rounded-lg border border-white/[0.04] bg-white/[0.01] p-4 transition-colors hover:border-white/[0.08] hover:bg-white/[0.02]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                    <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold text-white/70">
                      {TRIGGER_LABELS[path.triggerType] ?? path.triggerType}
                    </p>
                    <p className="font-mono text-[9px] text-white/25">
                      {path.sourceAgentId ? `From: ${getAgentName(path.sourceAgentId)}` : "Any agent"}
                      {" → "}
                      {path.escalateToAgentId ? getAgentName(path.escalateToAgentId) : "Human"}
                      {" · "}
                      Timeout: {path.timeoutMinutes}m
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${TRIGGER_COLORS[path.triggerType] ?? "bg-white/5 text-white/25"}`}>
                    {path.triggerType.toUpperCase().replace("_", " ")}
                  </span>
                  {/* Auto-escalate toggle */}
                  <button
                    onClick={() => handleToggleAutoEscalate(path)}
                    className={`h-5 w-9 rounded-full transition-colors ${
                      path.autoEscalate ? "bg-neo/40" : "bg-white/[0.08]"
                    }`}
                    title={path.autoEscalate ? "Auto-escalate enabled" : "Auto-escalate disabled"}
                  >
                    <div
                      className={`h-4 w-4 rounded-full bg-white transition-transform ${
                        path.autoEscalate ? "translate-x-[18px]" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(path)}
                      className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(path.id)}
                      className="rounded p-1 text-red-400/40 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Active Escalations Tab */}
      {tab === "active" && (
        <div className="mt-4">
          <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
            ACTIVE ESCALATIONS
          </h2>
          <div className="mt-3 space-y-2">
            {activeEscalations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.08] py-8 text-center">
                <p className="font-mono text-xs text-white/30">No active escalations</p>
                <p className="mt-1 font-mono text-[10px] text-white/20">
                  Escalations appear here when triggered by blocked tasks, agent failures, etc.
                </p>
              </div>
            ) : (
              activeEscalations.map((esc) => {
                const triggerType = esc.requestType.replace("escalation:", "");
                return (
                  <div
                    key={esc.id}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/[0.02] p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${TRIGGER_COLORS[triggerType] ?? "bg-amber-500/10 text-amber-400"}`}>
                        {TRIGGER_LABELS[triggerType] ?? triggerType}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-white/50">
                          Triggered by {esc.requestedBy}
                        </p>
                        <p className="font-mono text-[9px] text-white/20">
                          {timeAgo(esc.createdAt)}
                        </p>
                      </div>
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-amber-400">
                        PENDING
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-bg-primary p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-neo">
              {editPath ? "EDIT ESCALATION PATH" : "ADD ESCALATION PATH"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">TRIGGER TYPE</label>
                <select
                  value={formTriggerType}
                  onChange={(e) => setFormTriggerType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">Select trigger...</option>
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">SOURCE AGENT (OPTIONAL)</label>
                <select
                  value={formSourceAgentId}
                  onChange={(e) => setFormSourceAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">Any agent</option>
                  {agents.map((a) => (
                    <option key={a.callsign} value={a.callsign}>
                      {a.emoji} {a.name} ({a.callsign})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">ESCALATE TO AGENT</label>
                <select
                  value={formEscalateToAgentId}
                  onChange={(e) => setFormEscalateToAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">Human (no agent)</option>
                  {agents.map((a) => (
                    <option key={a.callsign} value={a.callsign}>
                      {a.emoji} {a.name} ({a.callsign})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">TIMEOUT (MINUTES)</label>
                <input
                  type="number"
                  value={formTimeoutMinutes}
                  onChange={(e) => setFormTimeoutMinutes(parseInt(e.target.value, 10) || 60)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormAutoEscalate(!formAutoEscalate)}
                  className={`h-5 w-9 rounded-full transition-colors ${
                    formAutoEscalate ? "bg-neo/40" : "bg-white/[0.08]"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      formAutoEscalate ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="font-mono text-[10px] tracking-wider text-white/40">
                  AUTO-ESCALATE
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-xs text-white/40 transition-colors hover:bg-white/[0.04]"
              >
                CANCEL
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formTriggerType}
                className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {saving ? "SAVING..." : editPath ? "UPDATE" : "CREATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
