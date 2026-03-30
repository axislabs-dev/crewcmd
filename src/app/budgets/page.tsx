"use client";

import { useState, useEffect, useCallback } from "react";

interface Budget {
  id: string;
  agentId: string;
  companyId: string;
  monthlyLimit: string;
  currentSpend: string;
  periodStart: string;
  alertThreshold: number;
  autoPause: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

interface CostSummary {
  groupKey: string;
  totalCost: string;
  totalTokensIn: number;
  totalTokensOut: number;
  eventCount: number;
}

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [costSummary, setCostSummary] = useState<CostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formAgentId, setFormAgentId] = useState("");
  const [formLimit, setFormLimit] = useState("");
  const [formThreshold, setFormThreshold] = useState("80");
  const [formAutoPause, setFormAutoPause] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [budgetsRes, agentsRes, summaryRes] = await Promise.all([
        fetch(`/api/budgets?company_id=${cId}`),
        fetch("/api/agents"),
        fetch(`/api/cost-events/summary?company_id=${cId}&group_by=agent`),
      ]);

      if (budgetsRes.ok) setBudgets(await budgetsRes.json());
      if (agentsRes.ok) setAgents(await agentsRes.json());
      if (summaryRes.ok) setCostSummary(await summaryRes.json());
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
    if (cId) {
      fetchData(cId);
    } else {
      setLoading(false);
    }
  }, [fetchData]);

  function getAgentName(callsign: string): string {
    const agent = agents.find((a) => a.callsign === callsign);
    return agent ? `${agent.emoji} ${agent.name}` : callsign;
  }

  function openCreate() {
    setFormAgentId("");
    setFormLimit("");
    setFormThreshold("80");
    setFormAutoPause(true);
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formAgentId || !formLimit) return;
    setSaving(true);

    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: formAgentId,
          companyId,
          monthlyLimit: formLimit,
          alertThreshold: parseInt(formThreshold),
          autoPause: formAutoPause,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        fetchData(companyId);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAutoPause(budget: Budget) {
    if (!companyId) return;
    try {
      await fetch(`/api/budgets/${budget.agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          autoPause: !budget.autoPause,
        }),
      });
      fetchData(companyId);
    } catch {
      // ignore
    }
  }

  async function handleDelete(agentId: string) {
    if (!companyId) return;
    try {
      await fetch(`/api/budgets/${agentId}?company_id=${companyId}`, {
        method: "DELETE",
      });
      fetchData(companyId);
    } catch {
      // ignore
    }
  }

  // Compute summary stats
  const totalBudget = budgets.reduce((sum, b) => sum + parseFloat(b.monthlyLimit), 0);
  const totalSpend = budgets.reduce((sum, b) => sum + parseFloat(b.currentSpend), 0);

  const topSpender = costSummary.length > 0
    ? costSummary.reduce((max, s) => parseFloat(s.totalCost) > parseFloat(max.totalCost) ? s : max)
    : null;

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
            Select a company from the sidebar to view budgets.
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
          <h1 className="font-mono text-lg font-bold tracking-wider text-neo">BUDGETS</h1>
          <p className="mt-1 font-mono text-xs text-white/30">
            Agent spend tracking &amp; cost control
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30"
        >
          + SET BUDGET
        </button>
      </div>

      {/* Summary Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
          <p className="font-mono text-[10px] tracking-wider text-white/30">TOTAL SPEND THIS MONTH</p>
          <p className="mt-1 font-mono text-xl font-bold text-white/80">
            ${totalSpend.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
          <p className="font-mono text-[10px] tracking-wider text-white/30">TOTAL BUDGET</p>
          <p className="mt-1 font-mono text-xl font-bold text-white/80">
            ${totalBudget.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
          <p className="font-mono text-[10px] tracking-wider text-white/30">TOP SPENDER</p>
          <p className="mt-1 font-mono text-xl font-bold text-white/80">
            {topSpender ? getAgentName(topSpender.groupKey) : "—"}
          </p>
          {topSpender && (
            <p className="mt-0.5 font-mono text-[10px] text-white/30">
              ${parseFloat(topSpender.totalCost).toFixed(2)}
            </p>
          )}
        </div>
      </div>

      {/* Per-Agent Budget Table */}
      <div className="mt-6">
        <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">AGENT BUDGETS</h2>
        <div className="mt-3 space-y-2">
          {budgets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.08] py-12 text-center">
              <p className="font-mono text-xs text-white/30">No budgets configured</p>
              <p className="mt-1 font-mono text-[10px] text-white/20">
                Set a budget to start tracking agent spend.
              </p>
              <button
                onClick={openCreate}
                className="mt-4 rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30"
              >
                SET FIRST BUDGET
              </button>
            </div>
          ) : (
            budgets.map((budget) => {
              const limit = parseFloat(budget.monthlyLimit);
              const spend = parseFloat(budget.currentSpend);
              const pct = limit > 0 ? Math.min(100, (spend / limit) * 100) : 0;
              const isOver = pct >= 100;
              const isWarning = pct >= budget.alertThreshold && !isOver;

              return (
                <div
                  key={budget.id}
                  className="group flex items-center gap-4 rounded-lg border border-white/[0.04] bg-white/[0.01] p-4 transition-colors hover:border-white/[0.08] hover:bg-white/[0.02]"
                >
                  {/* Agent name */}
                  <div className="min-w-0 flex-shrink-0 w-40">
                    <p className="truncate font-mono text-xs text-white/80">
                      {getAgentName(budget.agentId)}
                    </p>
                    <p className="font-mono text-[9px] text-white/25">{budget.agentId}</p>
                  </div>

                  {/* Progress bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-white/40">
                        ${spend.toFixed(2)} / ${limit.toFixed(2)}
                      </span>
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          isOver
                            ? "text-red-400"
                            : isWarning
                              ? "text-amber-400"
                              : "text-emerald-400"
                        }`}
                      >
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isOver
                            ? "bg-red-500"
                            : isWarning
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Auto-pause toggle */}
                  <button
                    onClick={() => handleToggleAutoPause(budget)}
                    className={`flex-shrink-0 rounded px-2 py-1 font-mono text-[9px] tracking-wider transition-colors ${
                      budget.autoPause
                        ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                        : "bg-white/[0.04] text-white/30 hover:bg-white/[0.06]"
                    }`}
                    title={budget.autoPause ? "Auto-pause enabled — click to disable" : "Auto-pause disabled — click to enable"}
                  >
                    {budget.autoPause ? "AUTO-PAUSE ON" : "AUTO-PAUSE OFF"}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(budget.agentId)}
                    className="flex-shrink-0 rounded p-1 text-red-400/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
                    title="Remove budget"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Cost Breakdown Placeholder */}
      <div className="mt-8">
        <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">COST BREAKDOWN</h2>
        <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <p className="font-mono text-xs text-white/25">
            Charts coming soon — cost breakdown by model, agent, and time period
          </p>
        </div>
      </div>

      {/* Add Budget Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-bg-primary p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-neo">
              SET AGENT BUDGET
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">AGENT</label>
                <select
                  value={formAgentId}
                  onChange={(e) => setFormAgentId(e.target.value)}
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

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">
                  MONTHLY LIMIT (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formLimit}
                  onChange={(e) => setFormLimit(e.target.value)}
                  placeholder="100.00"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">
                  ALERT THRESHOLD (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={formThreshold}
                  onChange={(e) => setFormThreshold(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormAutoPause(!formAutoPause)}
                  className={`h-5 w-9 rounded-full transition-colors ${
                    formAutoPause ? "bg-neo/40" : "bg-white/[0.08]"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      formAutoPause ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="font-mono text-[10px] tracking-wider text-white/40">
                  AUTO-PAUSE WHEN BUDGET EXCEEDED
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
                disabled={saving || !formAgentId || !formLimit}
                className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {saving ? "SAVING..." : "SET BUDGET"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
