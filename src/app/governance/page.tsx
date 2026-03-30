"use client";

import { useState, useEffect, useCallback } from "react";

interface Gate {
  id: string;
  companyId: string;
  gateType: string;
  requiresHuman: boolean;
  approverAgentId: string | null;
  approverUserId: string | null;
  createdAt: string;
}

interface ApprovalRequest {
  id: string;
  gateId: string;
  companyId: string;
  requestedBy: string;
  requestType: string;
  payload: Record<string, unknown>;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

const GATE_TYPES = [
  "agent_hire",
  "strategy_change",
  "budget_increase",
  "config_change",
  "task_escalation",
] as const;

const GATE_LABELS: Record<string, string> = {
  agent_hire: "Agent Hire",
  strategy_change: "Strategy Change",
  budget_increase: "Budget Increase",
  config_change: "Config Change",
  task_escalation: "Task Escalation",
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

export default function GovernancePage() {
  const [tab, setTab] = useState<"gates" | "requests">("gates");
  const [gates, setGates] = useState<Gate[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [historyRequests, setHistoryRequests] = useState<ApprovalRequest[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showGateModal, setShowGateModal] = useState(false);
  const [editGate, setEditGate] = useState<Gate | null>(null);
  const [formGateType, setFormGateType] = useState<string>("");
  const [formRequiresHuman, setFormRequiresHuman] = useState(true);
  const [formApproverAgentId, setFormApproverAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [gatesRes, pendingRes, historyRes, agentsRes] = await Promise.all([
        fetch(`/api/approval-gates?company_id=${cId}`),
        fetch(`/api/approval-requests?company_id=${cId}&status=pending`),
        fetch(`/api/approval-requests?company_id=${cId}`),
        fetch("/api/agents"),
      ]);
      if (gatesRes.ok) setGates(await gatesRes.json());
      if (pendingRes.ok) setPendingRequests(await pendingRes.json());
      if (historyRes.ok) {
        const all: ApprovalRequest[] = await historyRes.json();
        setHistoryRequests(all.filter((r) => r.status !== "pending"));
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

  function openCreateGate() {
    setEditGate(null);
    setFormGateType("");
    setFormRequiresHuman(true);
    setFormApproverAgentId("");
    setShowGateModal(true);
  }

  function openEditGate(gate: Gate) {
    setEditGate(gate);
    setFormGateType(gate.gateType);
    setFormRequiresHuman(gate.requiresHuman);
    setFormApproverAgentId(gate.approverAgentId ?? "");
    setShowGateModal(true);
  }

  async function handleSaveGate() {
    if (!companyId || !formGateType) return;
    setSaving(true);
    try {
      if (editGate) {
        await fetch(`/api/approval-gates/${editGate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gateType: formGateType,
            requiresHuman: formRequiresHuman,
            approverAgentId: formApproverAgentId || null,
          }),
        });
      } else {
        await fetch("/api/approval-gates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            gateType: formGateType,
            requiresHuman: formRequiresHuman,
            approverAgentId: formApproverAgentId || null,
          }),
        });
      }
      setShowGateModal(false);
      fetchData(companyId);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGate(gateId: string) {
    try {
      await fetch(`/api/approval-gates/${gateId}`, { method: "DELETE" });
      if (companyId) fetchData(companyId);
    } catch {
      // ignore
    }
  }

  async function handleDecision(requestId: string, approved: boolean) {
    try {
      await fetch(`/api/approval-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved,
          decidedBy: "human_user",
        }),
      });
      if (companyId) fetchData(companyId);
    } catch {
      // ignore
    }
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
            Select a company from the sidebar to manage governance.
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
          <h1 className="font-mono text-lg font-bold tracking-wider text-neo">GOVERNANCE</h1>
          <p className="mt-1 font-mono text-xs text-white/30">
            Approval gates, requests &amp; controls
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg bg-white/[0.02] p-1">
        <button
          onClick={() => setTab("gates")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "gates" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          APPROVAL GATES
        </button>
        <button
          onClick={() => setTab("requests")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "requests" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          REQUESTS
          {pendingRequests.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] text-amber-400">
              {pendingRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* Gates Tab */}
      {tab === "gates" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
              CONFIGURED GATES
            </h2>
            <button
              onClick={openCreateGate}
              className="rounded-lg bg-neo/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-neo transition-colors hover:bg-neo/30"
            >
              + ADD GATE
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {gates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.08] py-12 text-center">
                <p className="font-mono text-xs text-white/30">No approval gates configured</p>
                <p className="mt-1 font-mono text-[10px] text-white/20">
                  Gates control which actions require approval before proceeding.
                </p>
              </div>
            ) : (
              gates.map((gate) => (
                <div
                  key={gate.id}
                  className="group flex items-center gap-4 rounded-lg border border-white/[0.04] bg-white/[0.01] p-4 transition-colors hover:border-white/[0.08] hover:bg-white/[0.02]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                    <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold text-white/70">
                      {GATE_LABELS[gate.gateType] ?? gate.gateType}
                    </p>
                    <p className="font-mono text-[9px] text-white/25">
                      {gate.requiresHuman ? "Requires human approval" : `Approved by: ${getAgentName(gate.approverAgentId ?? "")}`}
                    </p>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${
                      gate.requiresHuman
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-purple-500/10 text-purple-400"
                    }`}
                  >
                    {gate.requiresHuman ? "HUMAN" : "AGENT"}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditGate(gate)}
                      className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteGate(gate.id)}
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

      {/* Requests Tab */}
      {tab === "requests" && (
        <div className="mt-4 space-y-6">
          {/* Pending */}
          <div>
            <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
              PENDING REQUESTS
            </h2>
            <div className="mt-3 space-y-2">
              {pendingRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/[0.08] py-8 text-center">
                  <p className="font-mono text-xs text-white/30">No pending requests</p>
                </div>
              ) : (
                pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/[0.02] p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white/70">
                            {GATE_LABELS[req.requestType] ?? req.requestType}
                          </span>
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-amber-400">
                            PENDING
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-white/25">
                          Requested by {req.requestedBy} {timeAgo(req.createdAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDecision(req.id, true)}
                          className="rounded-lg bg-emerald-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-emerald-400 transition-colors hover:bg-emerald-500/30"
                        >
                          APPROVE
                        </button>
                        <button
                          onClick={() => handleDecision(req.id, false)}
                          className="rounded-lg bg-red-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-red-400 transition-colors hover:bg-red-500/30"
                        >
                          REJECT
                        </button>
                      </div>
                    </div>
                    {/* Payload toggle */}
                    <button
                      onClick={() => setExpandedRequest(expandedRequest === req.id ? null : req.id)}
                      className="mt-2 font-mono text-[9px] text-white/20 hover:text-white/40"
                    >
                      {expandedRequest === req.id ? "HIDE PAYLOAD" : "SHOW PAYLOAD"}
                    </button>
                    {expandedRequest === req.id && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] text-white/40">
                        {JSON.stringify(req.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* History */}
          <div>
            <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
              HISTORY
            </h2>
            <div className="mt-3 space-y-1">
              {historyRequests.length === 0 ? (
                <p className="font-mono text-[10px] text-white/20">No history yet</p>
              ) : (
                historyRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        req.status === "approved" ? "bg-emerald-400" : req.status === "rejected" ? "bg-red-400" : "bg-white/20"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[10px] text-white/50">
                        {GATE_LABELS[req.requestType] ?? req.requestType}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-white/20">
                        by {req.requestedBy}
                      </span>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[8px] tracking-wider ${
                        req.status === "approved"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : req.status === "rejected"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-white/5 text-white/25"
                      }`}
                    >
                      {req.status.toUpperCase()}
                    </span>
                    <span className="font-mono text-[9px] text-white/15">
                      {timeAgo(req.decidedAt ?? req.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gate Modal */}
      {showGateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-bg-primary p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-neo">
              {editGate ? "EDIT GATE" : "ADD APPROVAL GATE"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">GATE TYPE</label>
                <select
                  value={formGateType}
                  onChange={(e) => setFormGateType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                >
                  <option value="">Select type...</option>
                  {GATE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {GATE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormRequiresHuman(!formRequiresHuman)}
                  className={`h-5 w-9 rounded-full transition-colors ${
                    formRequiresHuman ? "bg-neo/40" : "bg-white/[0.08]"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      formRequiresHuman ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="font-mono text-[10px] tracking-wider text-white/40">
                  REQUIRES HUMAN APPROVAL
                </span>
              </div>

              {!formRequiresHuman && (
                <div>
                  <label className="block font-mono text-[10px] tracking-wider text-white/40">APPROVER AGENT</label>
                  <select
                    value={formApproverAgentId}
                    onChange={(e) => setFormApproverAgentId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                  >
                    <option value="">Select agent...</option>
                    {agents.map((a) => (
                      <option key={a.callsign} value={a.callsign}>
                        {a.emoji} {a.name} ({a.callsign})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowGateModal(false)}
                className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-xs text-white/40 transition-colors hover:bg-white/[0.04]"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveGate}
                disabled={saving || !formGateType}
                className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {saving ? "SAVING..." : editGate ? "UPDATE" : "CREATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
