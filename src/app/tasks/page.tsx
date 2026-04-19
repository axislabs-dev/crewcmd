"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Agent, Task, TaskStatus, TaskPriority } from "@/lib/data";
import { TaskBoard } from "@/components/task-board";
import { TaskTable } from "@/components/task-table";
import { getUnknownAgentOption, resolveAssignedAgentValue } from "@/lib/agent-lookup";
import { useWorkspace } from "@/components/company-context";

interface Project {
  id: string;
  name: string;
  color?: string;
}

type ViewMode = "board" | "table";

const VIEW_STORAGE_KEY = "mc_task_view";

export default function TasksPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", priority: "medium", status: "inbox", projectId: "" });
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Load persisted view preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "table" || saved === "board") setViewMode(saved);
    } catch { /* ignore */ }
  }, []);

  function switchView(mode: ViewMode) {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* ignore */ }
  }

  const refresh = useCallback(async () => {
    if (workspaceLoading) return;

    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const params = workspace?.id
        ? `?workspaceId=${encodeURIComponent(workspace.id)}`
        : "";
      const [tasksRes, agentsRes, projRes] = await Promise.all([
        fetch(`/api/tasks${params}`).catch(() => null),
        fetch(`/api/agents${params}`).catch(() => null),
        fetch(`/api/projects${params}`).catch(() => null),
      ]);

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        setTasks(Array.isArray(data) ? data : []);
      }

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        setAgents(Array.isArray(data) ? data : data.agents ?? []);
      } else {
        setAgentsError("Couldn't load assignable agents.");
      }

      if (projRes?.ok) {
        const data = await projRes.json();
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch {
      setAgentsError("Couldn't load assignable agents.");
    } finally {
      setAgentsLoading(false);
    }
  }, [workspace?.id, workspaceLoading]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const counts: Record<TaskStatus, number> = {
    backlog: 0,
    inbox: 0,
    queued: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  };
  for (const t of tasks) {
    counts[t.status]++;
  }

  // Handlers for table inline updates and deletes
  const handleTaskUpdate = useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
  }, []);

  const handleTaskDelete = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  // Board-filtered tasks (by projectFilter)
  const boardTasks =
    projectFilter === "all"
      ? tasks
      : projectFilter === "none"
      ? tasks.filter((t) => !t.projectId)
      : tasks.filter((t) => t.projectId === projectFilter);

  const agentStatusMessage = agentsLoading
    ? "Loading assignable agents…"
    : agentsError
    ? agentsError
    : agents.length === 0
    ? "No assignable agents are available in the current workspace."
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <div>
        <nav className="border-b border-[var(--border-subtle)] px-3 py-2 sm:px-6 sm:py-3">
          {/* Mobile: compact single-row layout */}
          <div className="flex items-center justify-between gap-2 sm:hidden">
            <div className="flex items-center gap-2">
              <Link href="/" className="font-mono text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]">
                MC
              </Link>
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">/</span>
              <span className="font-mono text-[10px] font-bold text-[var(--text-primary)]">TASKS</span>
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">({tasks.length})</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Compact view switcher */}
              <div className="flex items-center gap-0.5 rounded border border-[var(--border-medium)] bg-[var(--bg-surface)] p-0.5">
                <ViewBtn label="" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5" /></svg>} active={viewMode === "board"} onClick={() => switchView("board")} />
                <ViewBtn label="" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>} active={viewMode === "table"} onClick={() => switchView("table")} />
              </div>
              <button onClick={() => setShowCreate(true)} className="flex h-7 w-7 items-center justify-center rounded border border-[var(--accent-medium)] bg-[var(--accent-soft)] text-[var(--accent)]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>
          </div>

          {/* Desktop: full layout */}
          <div className="hidden items-center justify-between gap-4 sm:flex">
            <div className="flex items-center gap-3">
              <Link href="/" className="font-mono text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]">
                COMMAND CENTER
              </Link>
              <span className="font-mono text-xs text-[var(--text-tertiary)]">/</span>
              <span className="font-mono text-xs font-bold text-[var(--text-primary)]">TASKS</span>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* View switcher */}
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-0.5">
                <ViewBtn label="BOARD" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5" /></svg>} active={viewMode === "board"} onClick={() => switchView("board")} />
                <ViewBtn label="TABLE" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>} active={viewMode === "table"} onClick={() => switchView("table")} />
              </div>

              <div className="h-4 w-px bg-[var(--border-medium)]" />

              {/* Project filter (only on board view) */}
              {viewMode === "board" && (
                <div className="flex items-center gap-2">
                  <select
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="appearance-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-3 py-2 pr-8 font-mono text-[10px] tracking-wider text-[var(--accent)]/70 outline-none transition-all duration-200 focus:border-[var(--accent-medium)] focus:shadow-[0_0_10px_rgba(0,240,255,0.1)]"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(0,240,255,0.4)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 8px center",
                    }}
                  >
                    <option value="all" style={{ backgroundColor: "var(--bg-surface-strong)", color: "var(--text-secondary)" }}>📁 ALL PROJECTS</option>
                    <option value="none" style={{ backgroundColor: "var(--bg-surface-strong)", color: "var(--text-tertiary)" }}>⊘ NO PROJECT</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} style={{ backgroundColor: "var(--bg-surface-strong)", color: "var(--text-secondary)" }}>📁 {p.name.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-4 py-2 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-soft)] hover:shadow-[0_0_15px_rgba(0,240,255,0.15)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                NEW TASK
              </button>
              <div className="h-4 w-px bg-[var(--border-medium)]" />
              <TaskStat label="TOTAL" value={tasks.length} />
              <div className="h-4 w-px bg-[var(--border-medium)]" />
              <TaskStat label="BACKLOG" value={counts.backlog} color="var(--text-tertiary)" />
              <TaskStat label="INBOX" value={counts.inbox} color="var(--text-secondary)" />
              <TaskStat label="QUEUED" value={counts.queued} color="var(--accent)" />
              <TaskStat label="IN PROGRESS" value={counts.in_progress} color="var(--warning)" />
              <TaskStat label="REVIEW" value={counts.review} color="#8f5c7f" />
              <TaskStat label="DONE" value={counts.done} color="var(--success)" />
            </div>
          </div>
        </nav>

        {/* New Task Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="glass-card w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-sm font-bold tracking-[0.15em] text-[var(--text-primary)]">NEW TASK</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">TITLE</label>
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title..."
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--accent-medium)]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="What needs to be done..."
                    rows={3}
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    inputMode="text"
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--accent-medium)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
                    <select
                      value={newTask.status}
                      onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="inbox">Inbox</option>
                      <option value="queued">Queued</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PRIORITY</label>
                    <select
                      value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PROJECT</label>
                    <select
                      value={newTask.projectId}
                      onChange={(e) => setNewTask({ ...newTask, projectId: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
                    >
                      <option value="">No project (standalone)</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  CANCEL
                </button>
                <button
                  onClick={async () => {
                    if (!newTask.title.trim()) return;
                    setCreating(true);
                    try {
                      const body: Record<string, string> = {
                        title: newTask.title,
                        description: newTask.description,
                        priority: newTask.priority,
                        status: newTask.status,
                        createdBy: "roger",
                      };
                      if (workspace?.id) body.workspaceId = workspace.id;
                      if (newTask.projectId) body.projectId = newTask.projectId;
                      const res = await fetch("/api/tasks", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      });
                      if (res.ok) {
                        const created = await res.json();
                        setTasks([...tasks, created]);
                        setNewTask({ title: "", description: "", priority: "medium", status: "inbox", projectId: "" });
                        setShowCreate(false);
                      }
                    } finally {
                      setCreating(false);
                    }
                  }}
                  disabled={creating || !newTask.title.trim()}
                  className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent-medium)] disabled:opacity-30"
                >
                  {creating ? "CREATING..." : "CREATE TASK"}
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-2 sm:p-6">
          {agentStatusMessage && (
            <div className="mb-4 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
              {agentStatusMessage}
            </div>
          )}
          {viewMode === "board" ? (
            <TaskBoard
              initialTasks={boardTasks}
              workspaceId={workspace?.id ?? null}
              agents={agents}
              projects={projects}
              agentsLoading={agentsLoading}
              agentsError={agentsError}
            />
          ) : (
            <TaskTable
              tasks={tasks}
              agents={agents}
              projects={projects}
              agentsLoading={agentsLoading}
              agentsError={agentsError}
              onTaskUpdate={handleTaskUpdate}
              onTaskDelete={handleTaskDelete}
              onTaskClick={setSelectedTask}
            />
          )}
        </main>
      </div>

      {/* Task detail modal for table view clicks */}
      {selectedTask && viewMode === "table" && (
        <TableTaskModal
          task={selectedTask}
          agents={agents}
          projects={projects}
          agentsLoading={agentsLoading}
          agentsError={agentsError}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updates) => {
            handleTaskUpdate(selectedTask.id, updates);
            setSelectedTask((prev) => prev ? { ...prev, ...updates } : null);
          }}
          onDelete={() => {
            handleTaskDelete(selectedTask.id);
            setSelectedTask(null);
          }}
        />
      )}

      <footer className="border-t border-[var(--border-subtle)] px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
            CREWCMD v{process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}
          </span>
          <span className="font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
            crewcmd.dev
          </span>
        </div>
      </footer>
    </div>
  );
}

function ViewBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[9px] tracking-wider transition-all ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TaskStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {color && (
        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span className="font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">{label}</span>
      <span className="font-mono text-sm font-bold" style={{ color: color || "white" }}>
        {value}
      </span>
    </div>
  );
}

// Minimal task detail modal for table view — full detail opens from here
function TableTaskModal({
  task,
  agents,
  projects,
  agentsLoading,
  agentsError,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task;
  agents: Agent[];
  projects: Project[];
  agentsLoading: boolean;
  agentsError: string | null;
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: task.title,
    description: task.description || "",
    priority: task.priority,
    status: task.status,
    assignedAgentId: resolveAssignedAgentValue(agents, task.assignedAgentId),
    humanAssignee: task.humanAssignee || "",
    projectId: task.projectId || "",
  });

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const unknownAgent = getUnknownAgentOption(form.assignedAgentId, agents);
  const agentSelectStatus = agentsLoading
    ? "Loading agents..."
    : agentsError
    ? "Couldn't load agents"
    : agents.length === 0
    ? "No agents available in this company"
    : null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          priority: form.priority,
          status: form.status,
          assignedAgentId: form.assignedAgentId || null,
          humanAssignee: form.humanAssignee || null,
          projectId: form.projectId || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(updated);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm("Delete this task?")) return;
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onDelete();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card flex w-full max-w-lg flex-col gap-4 overflow-y-auto p-6"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
            TSK-{String(task.shortId).padStart(4, "0")} · EDIT TASK
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={del}
              className="rounded-lg border border-red-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-[var(--danger)]/40 transition-colors hover:text-[var(--danger)]"
            >
              DELETE
            </button>
            <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">TITLE</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
              >
                {(["backlog","inbox","queued","in_progress","review","done"] as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PRIORITY</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">AGENT</label>
              <select
                value={resolveAssignedAgentValue(agents, form.assignedAgentId)}
                onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
              >
                <option value="">Unassigned</option>
                {agentSelectStatus && <option value="" disabled>{agentSelectStatus}</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.callsign}</option>
                ))}
                {unknownAgent && <option value={unknownAgent.value}>{unknownAgent.label}</option>}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">HUMAN</label>
              <select
                value={form.humanAssignee}
                onChange={(e) => setForm({ ...form, humanAssignee: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
              >
                <option value="">None</option>
                <option value="admin">👤 Admin</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PROJECT</label>
              <select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-medium)]"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>📁 {p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            CANCEL
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-[10px] tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-medium)] disabled:opacity-30"
          >
            {saving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>
    </div>
  );
}
