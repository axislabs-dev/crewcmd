"use client";

import { useState, useEffect, useCallback } from "react";

interface Schedule {
  id: string;
  companyId: string;
  agentId: string;
  schedule: string;
  enabled: boolean;
  timezone: string;
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  maxDurationMinutes: number;
  createdAt: string;
}

interface Execution {
  id: string;
  scheduleId: string;
  agentId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  tasksDiscovered: number;
  tasksCompleted: number;
  actionsTaken: Record<string, unknown> | null;
  error: string | null;
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

const CRON_PRESETS: Record<string, string> = {
  "Every 4 hours": "0 */4 * * *",
  "Every 8 hours": "0 */8 * * *",
  "Every 12 hours": "0 */12 * * *",
  "Daily (midnight)": "0 0 * * *",
  "Daily (9am)": "0 9 * * *",
  "Every 30 minutes": "*/30 * * * *",
  "Hourly": "0 * * * *",
};

function cronToHuman(cron: string): string {
  const presetEntry = Object.entries(CRON_PRESETS).find(([, v]) => v === cron);
  if (presetEntry) return presetEntry[0];
  return cron;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 0) return `in ${Math.abs(mins)}m`;
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

const STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-red-500/10 text-red-400",
  timed_out: "bg-amber-500/10 text-amber-400",
  cancelled: "bg-white/5 text-white/25",
};

export default function HeartbeatsPage() {
  const [tab, setTab] = useState<"schedules" | "history">("schedules");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [formAgentId, setFormAgentId] = useState("");
  const [formCron, setFormCron] = useState("");
  const [formTimezone, setFormTimezone] = useState("UTC");
  const [formMaxDuration, setFormMaxDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [schedulesRes, executionsRes, agentsRes] = await Promise.all([
        fetch(`/api/heartbeat-schedules?company_id=${cId}`),
        fetch(`/api/heartbeat-executions?company_id=${cId}`),
        fetch("/api/agents"),
      ]);
      if (schedulesRes.ok) setSchedules(await schedulesRes.json());
      if (executionsRes.ok) setExecutions(await executionsRes.json());
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
    setEditSchedule(null);
    setFormAgentId("");
    setFormCron("0 */4 * * *");
    setFormTimezone("UTC");
    setFormMaxDuration(30);
    setShowModal(true);
  }

  function openEdit(schedule: Schedule) {
    setEditSchedule(schedule);
    setFormAgentId(schedule.agentId);
    setFormCron(schedule.schedule);
    setFormTimezone(schedule.timezone);
    setFormMaxDuration(schedule.maxDurationMinutes);
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formAgentId || !formCron) return;
    setSaving(true);
    try {
      if (editSchedule) {
        await fetch(`/api/heartbeat-schedules/${editSchedule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schedule: formCron,
            timezone: formTimezone,
            maxDurationMinutes: formMaxDuration,
          }),
        });
      } else {
        await fetch("/api/heartbeat-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            agentId: formAgentId,
            schedule: formCron,
            timezone: formTimezone,
            maxDurationMinutes: formMaxDuration,
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

  async function handleToggle(schedule: Schedule) {
    await fetch(`/api/heartbeat-schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !schedule.enabled }),
    });
    if (companyId) fetchData(companyId);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/heartbeat-schedules/${id}`, { method: "DELETE" });
    if (companyId) fetchData(companyId);
  }

  async function handleTrigger(scheduleId: string) {
    await fetch("/api/heartbeat-executions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId }),
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
            Select a company from the sidebar to manage heartbeat schedules.
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
          <h1 className="font-mono text-lg font-bold tracking-wider text-neo">HEARTBEATS</h1>
          <p className="mt-1 font-mono text-xs text-white/30">
            Agent wake schedules &amp; execution history
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg bg-white/[0.02] p-1">
        <button
          onClick={() => setTab("schedules")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "schedules" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          SCHEDULES
        </button>
        <button
          onClick={() => setTab("history")}
          className={`flex-1 rounded-md px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
            tab === "history" ? "bg-neo/10 text-neo" : "text-white/30 hover:text-white/50"
          }`}
        >
          EXECUTION HISTORY
          {executions.filter((e) => e.status === "running").length > 0 && (
            <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] text-blue-400">
              {executions.filter((e) => e.status === "running").length} running
            </span>
          )}
        </button>
      </div>

      {/* Schedules Tab */}
      {tab === "schedules" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
              AGENT SCHEDULES
            </h2>
            <button
              onClick={openCreate}
              className="rounded-lg bg-neo/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-neo transition-colors hover:bg-neo/30"
            >
              + ADD SCHEDULE
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {schedules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.08] py-12 text-center">
                <p className="font-mono text-xs text-white/30">No heartbeat schedules configured</p>
                <p className="mt-1 font-mono text-[10px] text-white/20">
                  Schedules define when agents wake up to check for work.
                </p>
              </div>
            ) : (
              schedules.map((s) => {
                const lastExec = executions.find((e) => e.scheduleId === s.id);
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-4 rounded-lg border p-4 transition-colors ${
                      s.enabled
                        ? "border-white/[0.04] bg-white/[0.01] hover:border-white/[0.08] hover:bg-white/[0.02]"
                        : "border-white/[0.02] bg-white/[0.005] opacity-60"
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neo/10">
                      <svg className="h-4 w-4 text-neo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-white/70">
                        {getAgentName(s.agentId)}
                      </p>
                      <p className="font-mono text-[9px] text-white/25">
                        {cronToHuman(s.schedule)} &middot; {s.timezone} &middot; max {s.maxDurationMinutes}m
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-[9px] text-white/20">
                        {s.lastExecutedAt ? `Last: ${timeAgo(s.lastExecutedAt)}` : "Never run"}
                      </span>
                      <span className="font-mono text-[9px] text-white/20">
                        {s.nextExecutionAt ? `Next: ${timeUntil(s.nextExecutionAt)}` : "—"}
                      </span>
                    </div>
                    {lastExec && (
                      <span className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${STATUS_STYLES[lastExec.status] ?? "bg-white/5 text-white/25"}`}>
                        {lastExec.status.toUpperCase().replace("_", " ")}
                      </span>
                    )}
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(s)}
                      className={`h-5 w-9 rounded-full transition-colors ${
                        s.enabled ? "bg-neo/40" : "bg-white/[0.08]"
                      }`}
                    >
                      <div
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          s.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                        }`}
                      />
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleTrigger(s.id)}
                        title="Trigger Now"
                        className="rounded p-1 text-neo/50 hover:bg-neo/10 hover:text-neo"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="rounded p-1 text-red-400/40 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="mt-4">
          <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">
            RECENT EXECUTIONS
          </h2>
          <div className="mt-3 space-y-1">
            {executions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.08] py-8 text-center">
                <p className="font-mono text-xs text-white/30">No executions yet</p>
              </div>
            ) : (
              executions.map((exec) => (
                <div key={exec.id}>
                  <div
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 transition-colors hover:bg-white/[0.02]"
                    onClick={() => setExpandedExecution(expandedExecution === exec.id ? null : exec.id)}
                  >
                    <span className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${STATUS_STYLES[exec.status] ?? "bg-white/5 text-white/25"}`}>
                      {exec.status.toUpperCase().replace("_", " ")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[10px] text-white/50">
                        {getAgentName(exec.agentId)}
                      </span>
                    </div>
                    <div className="flex gap-4 font-mono text-[9px] text-white/20">
                      <span>Tasks: {exec.tasksDiscovered} found / {exec.tasksCompleted} done</span>
                      <span>{timeAgo(exec.startedAt)}</span>
                    </div>
                  </div>
                  {expandedExecution === exec.id && (
                    <div className="ml-4 mt-1 rounded-lg bg-black/30 p-3">
                      {exec.error && (
                        <p className="font-mono text-[10px] text-red-400">Error: {exec.error}</p>
                      )}
                      {exec.actionsTaken && (
                        <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] text-white/40">
                          {JSON.stringify(exec.actionsTaken, null, 2)}
                        </pre>
                      )}
                      {!exec.error && !exec.actionsTaken && (
                        <p className="font-mono text-[10px] text-white/20">No details available</p>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-bg-primary p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-neo">
              {editSchedule ? "EDIT SCHEDULE" : "ADD HEARTBEAT SCHEDULE"}
            </h2>

            <div className="mt-4 space-y-3">
              {!editSchedule && (
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
              )}

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">SCHEDULE</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(CRON_PRESETS).map(([label, cron]) => (
                    <button
                      key={cron}
                      onClick={() => setFormCron(cron)}
                      className={`rounded px-2 py-1 font-mono text-[9px] transition-colors ${
                        formCron === cron
                          ? "bg-neo/20 text-neo"
                          : "bg-white/[0.04] text-white/30 hover:bg-white/[0.08]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                  placeholder="0 */4 * * *"
                  className="mt-2 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">TIMEZONE</label>
                <input
                  type="text"
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">MAX DURATION (MINUTES)</label>
                <input
                  type="number"
                  value={formMaxDuration}
                  onChange={(e) => setFormMaxDuration(parseInt(e.target.value, 10) || 30)}
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
                />
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
                disabled={saving || !formCron || (!editSchedule && !formAgentId)}
                className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {saving ? "SAVING..." : editSchedule ? "UPDATE" : "CREATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
