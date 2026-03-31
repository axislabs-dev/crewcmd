"use client";

import { useState, useEffect, useCallback } from "react";

interface Routine {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  taskTemplate: {
    titlePattern: string;
    description: string | null;
    priority: string;
    assigneeAgentId: string | null;
    projectId: string | null;
  };
  schedule: string;
  enabled: boolean;
  lastCreatedAt: string | null;
  nextCreateAt: string | null;
  createdAt: string;
}

interface Agent {
  callsign: string;
  name: string;
  emoji: string;
}

const CRON_PRESETS: Record<string, string> = {
  "Daily (9am)": "0 9 * * *",
  "Daily (midnight)": "0 0 * * *",
  "Weekdays 9am": "0 9 * * 1-5",
  "Weekly (Monday)": "0 9 * * 1",
  "Every 12 hours": "0 */12 * * *",
  "Hourly": "0 * * * *",
};

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

function cronToHuman(cron: string): string {
  const presetEntry = Object.entries(CRON_PRESETS).find(([, v]) => v === cron);
  if (presetEntry) return presetEntry[0];
  return cron;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
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

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-500/10 text-slate-400",
  medium: "bg-blue-500/10 text-blue-400",
  high: "bg-amber-500/10 text-amber-400",
  critical: "bg-red-500/10 text-red-400",
};

export default function AutomationsPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editRoutine, setEditRoutine] = useState<Routine | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCron, setFormCron] = useState("0 9 * * *");
  const [formTitlePattern, setFormTitlePattern] = useState("");
  const [formTaskDescription, setFormTaskDescription] = useState("");
  const [formPriority, setFormPriority] = useState<string>("medium");
  const [formAssignee, setFormAssignee] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async (cId: string) => {
    try {
      const [routinesRes, agentsRes] = await Promise.all([
        fetch(`/api/routines?company_id=${cId}`),
        fetch("/api/agents"),
      ]);
      if (routinesRes.ok) setRoutines(await routinesRes.json());
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(Array.isArray(data) ? data : data.agents ?? []);
      }
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
    setEditRoutine(null);
    setFormTitle("");
    setFormDescription("");
    setFormCron("0 9 * * *");
    setFormTitlePattern("");
    setFormTaskDescription("");
    setFormPriority("medium");
    setFormAssignee("");
    setShowModal(true);
  }

  function openEdit(routine: Routine) {
    setEditRoutine(routine);
    setFormTitle(routine.title);
    setFormDescription(routine.description ?? "");
    setFormCron(routine.schedule);
    setFormTitlePattern(routine.taskTemplate.titlePattern);
    setFormTaskDescription(routine.taskTemplate.description ?? "");
    setFormPriority(routine.taskTemplate.priority);
    setFormAssignee(routine.taskTemplate.assigneeAgentId ?? "");
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formTitle || !formCron || !formTitlePattern) return;
    setSaving(true);
    const taskTemplate = {
      titlePattern: formTitlePattern,
      description: formTaskDescription || null,
      priority: formPriority,
      assigneeAgentId: formAssignee || null,
      projectId: null,
    };
    try {
      if (editRoutine) {
        await fetch(`/api/routines/${editRoutine.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle,
            description: formDescription || null,
            schedule: formCron,
            taskTemplate,
          }),
        });
      } else {
        await fetch("/api/routines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            title: formTitle,
            description: formDescription || null,
            schedule: formCron,
            taskTemplate,
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

  async function handleToggle(routine: Routine) {
    await fetch(`/api/routines/${routine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !routine.enabled }),
    });
    if (companyId) fetchData(companyId);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/routines/${id}`, { method: "DELETE" });
    if (companyId) fetchData(companyId);
  }

  async function handleTrigger(id: string) {
    await fetch(`/api/routines/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (companyId) fetchData(companyId);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--text-tertiary)]">No company selected</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Select a company from the sidebar to manage routines.
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
          <h1 className="font-mono text-lg font-bold tracking-wider text-[var(--accent)]">AUTOMATIONS</h1>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Recurring task templates &amp; auto-creation schedules
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
        >
          + ADD ROUTINE
        </button>
      </div>

      {/* Routines List */}
      <div className="mt-6 space-y-2">
        {routines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-medium)] py-12 text-center">
            <p className="text-xs text-[var(--text-tertiary)]">No routines configured</p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Routines auto-create tasks on a schedule from templates.
            </p>
          </div>
        ) : (
          routines.map((r) => (
            <div
              key={r.id}
              className={`group flex items-center gap-4 rounded-lg border p-4 transition-colors ${
                r.enabled
                  ? "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-60"
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[var(--text-primary)]">{r.title}</p>
                <p className="font-mono text-[9px] text-[var(--text-tertiary)]">
                  {cronToHuman(r.schedule)}
                  {r.taskTemplate.assigneeAgentId && ` · ${getAgentName(r.taskTemplate.assigneeAgentId)}`}
                </p>
                {r.description && (
                  <p className="mt-0.5 font-mono text-[9px] text-[var(--text-tertiary)]">{r.description}</p>
                )}
              </div>
              <span className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-wider ${PRIORITY_COLORS[r.taskTemplate.priority] ?? "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"}`}>
                {r.taskTemplate.priority.toUpperCase()}
              </span>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                  {r.lastCreatedAt ? `Last: ${timeAgo(r.lastCreatedAt)}` : "Never run"}
                </span>
                <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                  {r.nextCreateAt ? `Next: ${timeUntil(r.nextCreateAt)}` : "—"}
                </span>
              </div>
              {/* Toggle */}
              <button
                onClick={() => handleToggle(r)}
                className={`h-5 w-9 rounded-full transition-colors ${
                  r.enabled ? "bg-neo/40" : "bg-[var(--bg-tertiary)]"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white transition-transform ${
                    r.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleTrigger(r.id)}
                  title="Create Now"
                  className="rounded p-1 text-[var(--accent)]/50 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                  </svg>
                </button>
                <button
                  onClick={() => openEdit(r)}
                  className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--accent)]">
              {editRoutine ? "EDIT ROUTINE" : "ADD ROUTINE"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">ROUTINE NAME</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Daily standup report"
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION (OPTIONAL)</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">SCHEDULE</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(CRON_PRESETS).map(([label, cron]) => (
                    <button
                      key={cron}
                      onClick={() => setFormCron(cron)}
                      className={`rounded px-2 py-1 font-mono text-[9px] transition-colors ${
                        formCron === cron
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
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
                  placeholder="0 9 * * *"
                  className="mt-2 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                />
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <p className="text-[10px] tracking-wider text-[var(--text-tertiary)]">TASK TEMPLATE</p>

                <div className="mt-2 space-y-2">
                  <div>
                    <label className="block font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">TITLE PATTERN</label>
                    <input
                      type="text"
                      value={formTitlePattern}
                      onChange={(e) => setFormTitlePattern(e.target.value)}
                      placeholder="Daily report — {{date}}"
                      className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                    />
                    <p className="mt-0.5 font-mono text-[8px] text-[var(--text-tertiary)]">
                      Use {"{{date}}"} for today&apos;s date
                    </p>
                  </div>

                  <div>
                    <label className="block font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">TASK DESCRIPTION</label>
                    <textarea
                      value={formTaskDescription}
                      onChange={(e) => setFormTaskDescription(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none resize-none"
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">PRIORITY</label>
                      <select
                        value={formPriority}
                        onChange={(e) => setFormPriority(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1">
                      <label className="block font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">ASSIGNEE</label>
                      <select
                        value={formAssignee}
                        onChange={(e) => setFormAssignee(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                      >
                        <option value="">Unassigned</option>
                        {agents.map((a) => (
                          <option key={a.callsign} value={a.callsign}>
                            {a.emoji} {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                CANCEL
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formTitle || !formCron || !formTitlePattern}
                className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
              >
                {saving ? "SAVING..." : editRoutine ? "UPDATE" : "CREATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
