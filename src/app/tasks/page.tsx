"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Agent, Task, TaskStatus, TaskPriority } from "@/lib/data";
import { TaskBoard } from "@/components/task-board";
import { TaskTable } from "@/components/task-table";

interface Project {
  id: string;
  name: string;
  color?: string;
}

type ViewMode = "board" | "table";

const VIEW_STORAGE_KEY = "mc_task_view";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch("/api/tasks").catch(() => null),
        fetch("/api/openclaw/agents").catch(() => null),
      ]);

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        setTasks(Array.isArray(data) ? data : []);
      }

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
      }

      const projRes = await fetch("/api/projects").catch(() => null);
      if (projRes?.ok) {
        const data = await projRes.json();
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch {
      /* empty */
    }
  }, []);

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

  return (
    <div className="flex min-h-screen flex-col">
      {/* Horizontal scroll container syncs action bar with kanban scroll */}
      <div className={viewMode === "board" ? "overflow-x-auto" : ""}>
        <nav className={`border-b border-white/[0.06] px-3 py-2 sm:px-6 sm:py-3 ${viewMode === "board" ? "min-w-max" : ""}`}>
          {/* Mobile: compact single-row layout */}
          <div className="flex items-center justify-between gap-2 sm:hidden">
            <div className="flex items-center gap-2">
              <Link href="/" className="font-mono text-[10px] text-white/40 hover:text-neo">
                MC
              </Link>
              <span className="font-mono text-[10px] text-white/20">/</span>
              <span className="font-mono text-[10px] font-bold text-white/70">TASKS</span>
              <span className="font-mono text-[10px] text-white/25">({tasks.length})</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Compact view switcher */}
              <div className="flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.02] p-0.5">
                <ViewBtn label="" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5" /></svg>} active={viewMode === "board"} onClick={() => switchView("board")} />
                <ViewBtn label="" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>} active={viewMode === "table"} onClick={() => switchView("table")} />
              </div>
              <button onClick={() => setShowCreate(true)} className="flex h-7 w-7 items-center justify-center rounded border border-neo/20 bg-neo/10 text-neo">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>
          </div>

          {/* Desktop: full layout */}
          <div className="hidden items-center justify-between gap-4 sm:flex">
            <div className="flex items-center gap-3">
              <Link href="/" className="font-mono text-xs text-white/40 transition-colors hover:text-neo">
                MISSION CONTROL
              </Link>
              <span className="font-mono text-xs text-white/20">/</span>
              <span className="font-mono text-xs font-bold text-white/70">TASKS</span>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* View switcher */}
              <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
                <ViewBtn label="BOARD" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5" /></svg>} active={viewMode === "board"} onClick={() => switchView("board")} />
                <ViewBtn label="TABLE" icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>} active={viewMode === "table"} onClick={() => switchView("table")} />
              </div>

              <div className="h-4 w-px bg-white/10" />

              {/* Project filter (only on board view) */}
              {viewMode === "board" && (
                <div className="flex items-center gap-2">
                  <select
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="appearance-none rounded-lg border border-white/[0.08] bg-[#12121a] px-3 py-2 pr-8 font-mono text-[10px] tracking-wider text-neo/70 outline-none transition-all duration-200 focus:border-neo/30 focus:shadow-[0_0_10px_rgba(0,240,255,0.1)]"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(0,240,255,0.4)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 8px center",
                    }}
                  >
                    <option value="all" style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.5)" }}>📁 ALL PROJECTS</option>
                    <option value="none" style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.3)" }}>⊘ NO PROJECT</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.6)" }}>📁 {p.name.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg border border-neo/20 bg-neo/10 px-4 py-2 font-mono text-[10px] tracking-wider text-neo transition-all duration-200 hover:bg-neo/20 hover:shadow-[0_0_15px_rgba(0,240,255,0.15)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                NEW TASK
              </button>
              <div className="h-4 w-px bg-white/10" />
              <TaskStat label="TOTAL" value={tasks.length} />
              <div className="h-4 w-px bg-white/10" />
              <TaskStat label="BACKLOG" value={counts.backlog} color="#555" />
              <TaskStat label="INBOX" value={counts.inbox} color="#666" />
              <TaskStat label="QUEUED" value={counts.queued} color="#00f0ff" />
              <TaskStat label="IN PROGRESS" value={counts.in_progress} color="#f0ff00" />
              <TaskStat label="REVIEW" value={counts.review} color="#ff00aa" />
              <TaskStat label="DONE" value={counts.done} color="#00ff88" />
            </div>
          </div>
        </nav>

        {/* New Task Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="glass-card w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-mono text-sm font-bold tracking-[0.15em] text-white/80">NEW TASK</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">TITLE</label>
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title..."
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 placeholder-white/20 outline-none focus:border-neo/30"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">DESCRIPTION</label>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="What needs to be done..."
                    rows={3}
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    inputMode="text"
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 placeholder-white/20 outline-none focus:border-neo/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">STATUS</label>
                    <select
                      value={newTask.status}
                      onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="inbox">Inbox</option>
                      <option value="queued">Queued</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">PRIORITY</label>
                    <select
                      value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">PROJECT</label>
                    <select
                      value={newTask.projectId}
                      onChange={(e) => setNewTask({ ...newTask, projectId: e.target.value })}
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
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
                  className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-[10px] tracking-wider text-white/40 transition-colors hover:text-white/60"
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
                  className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-[10px] tracking-wider text-neo transition-all duration-200 hover:bg-neo/30 disabled:opacity-30"
                >
                  {creating ? "CREATING..." : "CREATE TASK"}
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-2 sm:p-6">
          {viewMode === "board" ? (
            <TaskBoard
              initialTasks={boardTasks}
              agents={agents}
              projects={projects}
            />
          ) : (
            <TaskTable
              tasks={tasks}
              agents={agents}
              projects={projects}
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

      <footer className="border-t border-white/[0.04] px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-wider text-white/20">
            MISSION CONTROL v0.2.0
          </span>
          <span className="font-mono text-[10px] tracking-wider text-white/20">
            AXISLABS.DEV
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
          ? "bg-neo/15 text-neo"
          : "text-white/30 hover:text-white/60"
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
      <span className="font-mono text-[10px] tracking-wider text-white/30">{label}</span>
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
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task;
  agents: Agent[];
  projects: Project[];
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
    assignedAgentId: task.assignedAgentId || "",
    humanAssignee: task.humanAssignee || "",
    projectId: task.projectId || "",
  });

  const projectMap = new Map(projects.map((p) => [p.id, p]));

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
          <span className="font-mono text-[10px] tracking-wider text-white/30">
            TSK-{String(task.shortId).padStart(4, "0")} · EDIT TASK
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={del}
              className="rounded-lg border border-red-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-red-400/40 transition-colors hover:text-red-400"
            >
              DELETE
            </button>
            <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">TITLE</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">DESCRIPTION</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">STATUS</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
              >
                {(["backlog","inbox","queued","in_progress","review","done"] as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">PRIORITY</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">AGENT</label>
              <select
                value={form.assignedAgentId}
                onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.callsign}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">HUMAN</label>
              <select
                value={form.humanAssignee}
                onChange={(e) => setForm({ ...form, humanAssignee: e.target.value })}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
              >
                <option value="">None</option>
                <option value="roger">👤 Roger</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">PROJECT</label>
              <select
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 outline-none focus:border-neo/30"
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
            className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-[10px] tracking-wider text-white/40 transition-colors hover:text-white/60"
          >
            CANCEL
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-[10px] tracking-wider text-neo transition-all hover:bg-neo/30 disabled:opacity-30"
          >
            {saving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>
    </div>
  );
}
