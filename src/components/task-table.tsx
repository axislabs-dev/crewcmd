"use client";

import { useState, useMemo, useCallback } from "react";
import type { Task, Agent, TaskStatus, TaskPriority, TaskSource } from "@/lib/data";

interface Project {
  id: string;
  name: string;
  color?: string;
  documents?: { name: string; url: string }[] | null;
}

interface TaskTableProps {
  tasks: Task[];
  agents: Agent[];
  projects?: Project[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskClick: (task: Task) => void;
}

const STATUS_ORDER: TaskStatus[] = ["backlog", "inbox", "queued", "in_progress", "review", "done"];

const statusColors: Record<TaskStatus, string> = {
  backlog: "#555",
  inbox: "#666",
  queued: "#00f0ff",
  in_progress: "#f0ff00",
  review: "#ff00aa",
  done: "#00ff88",
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  inbox: "Inbox",
  queued: "Queued",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const priorityStyles: Record<string, { text: string; bg: string }> = {
  low: { text: "text-[var(--text-tertiary)]", bg: "bg-[var(--bg-surface-hover)]" },
  medium: { text: "text-blue-400", bg: "bg-blue-400/10" },
  high: { text: "text-orange-400", bg: "bg-orange-400/10" },
  critical: { text: "text-red-400", bg: "bg-red-400/10" },
};

type SortKey = "title" | "status" | "priority" | "project" | "assignee" | "createdAt" | "updatedAt";
type SortDir = "asc" | "desc";

const sourceStyles: Record<TaskSource, { label: string; cls: string }> = {
  manual: { label: "manual", cls: "text-[var(--text-tertiary)] border-[var(--border-subtle)]" },
  error_log: { label: "error", cls: "text-red-400/70 border-red-400/20" },
  test_failure: { label: "test", cls: "text-orange-400/70 border-orange-400/20" },
  ui_scan: { label: "ui", cls: "text-blue-400/70 border-blue-400/20" },
  ci_failure: { label: "ci", cls: "text-red-400/70 border-red-400/20" },
  agent_initiative: { label: "agent", cls: "text-green-400/70 border-green-400/20" },
};

const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const PAGE_SIZE = 50;

export function TaskTable({ tasks, agents, projects = [], onTaskUpdate, onTaskDelete, onTaskClick }: TaskTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkAction, setBulkAction] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("queued");
  const [bulkPriority, setBulkPriority] = useState<TaskPriority>("medium");
  const [bulkLoading, setBulkLoading] = useState(false);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Unique assignees from tasks
  const assigneeOptions = useMemo(() => {
    const agentIds = new Set<string>();
    const humans = new Set<string>();
    for (const t of tasks) {
      if (t.assignedAgentId) agentIds.add(t.assignedAgentId);
      if (t.humanAssignee) humans.add(t.humanAssignee);
    }
    return { agentIds: [...agentIds], humans: [...humans] };
  }, [tasks]);

  // Filter + search + sort
  const filtered = useMemo(() => {
    let list = tasks;

    if (!showDone) list = list.filter((t) => t.status !== "done");

    if (filterStatus !== "all") list = list.filter((t) => t.status === filterStatus);
    if (filterProject === "none") {
      list = list.filter((t) => !t.projectId);
    } else if (filterProject !== "all") {
      list = list.filter((t) => t.projectId === filterProject);
    }
    if (filterAssignee !== "all") {
      if (filterAssignee === "unassigned") {
        list = list.filter((t) => !t.assignedAgentId && !t.humanAssignee);
      } else {
        list = list.filter(
          (t) => t.assignedAgentId === filterAssignee || t.humanAssignee === filterAssignee
        );
      }
    }
    if (filterPriority !== "all") list = list.filter((t) => t.priority === filterPriority);

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q));
    }

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "status":
          cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
          break;
        case "priority":
          cmp = (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0);
          break;
        case "project": {
          const pa = projectMap.get(a.projectId || "")?.name || "";
          const pb = projectMap.get(b.projectId || "")?.name || "";
          cmp = pa.localeCompare(pb);
          break;
        }
        case "assignee": {
          const aa = agentMap.get(a.assignedAgentId || "")?.callsign || a.humanAssignee || "";
          const ab = agentMap.get(b.assignedAgentId || "")?.callsign || b.humanAssignee || "";
          cmp = aa.localeCompare(ab);
          break;
        }
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "updatedAt":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [tasks, showDone, filterStatus, filterProject, filterAssignee, filterPriority, searchText, sortKey, sortDir, agentMap, projectMap]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page on filter change
  const resetPage = useCallback(() => setPage(0), []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    resetPage();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === paginated.length && paginated.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paginated.map((t) => t.id)));
    }
  }

  async function applyBulkAction() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    const ids = [...selected];

    try {
      let updates: Partial<Task> = {};

      if (bulkAction === "assign") {
        updates = { assignedAgentId: bulkAssignee || null };
      } else if (bulkAction === "status") {
        updates = { status: bulkStatus };
      } else if (bulkAction === "priority") {
        updates = { priority: bulkPriority };
      } else if (bulkAction === "archive") {
        updates = { status: "done" };
      } else if (bulkAction === "delete") {
        if (!confirm(`Delete ${ids.length} task(s)?`)) {
          setBulkLoading(false);
          return;
        }
        await Promise.all(
          ids.map((id) =>
            fetch(`/api/tasks/${id}`, { method: "DELETE" }).then((r) => {
              if (r.ok) onTaskDelete(id);
            })
          )
        );
        setSelected(new Set());
        setBulkLoading(false);
        return;
      }

      await Promise.all(
        ids.map((id) =>
          fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }).then(async (r) => {
            if (r.ok) {
              const updated = await r.json();
              onTaskUpdate(id, updated);
            }
          })
        )
      );
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  async function inlineUpdate(taskId: string, field: string, value: string | null) {
    const updates: Record<string, string | null> = { [field]: value };
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      onTaskUpdate(taskId, updated);
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return <span className="ml-1 text-[var(--text-tertiary)]">↕</span>;
    }
    return <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const allSelected = paginated.length > 0 && selected.size === paginated.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="flex flex-col gap-3">
      {/* Filter Bar */}
      {/* Mobile: search + compact row */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); resetPage(); }}
            className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] py-2 pl-7 pr-3 text-[11px] text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-neo/30"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <FilterSelect value={filterStatus} onChange={(v) => { setFilterStatus(v); resetPage(); }} options={[{ value: "all", label: "Status" }, ...STATUS_ORDER.map((s) => ({ value: s, label: statusLabels[s] }))]} placeholder="STATUS" compact />
          <FilterSelect value={filterPriority} onChange={(v) => { setFilterPriority(v); resetPage(); }} options={[{ value: "all", label: "Priority" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} placeholder="PRIORITY" compact />
          <button
            onClick={() => { setShowDone((v) => !v); resetPage(); }}
            className={`shrink-0 text-[10px] tracking-wider transition-colors ${
              showDone ? "text-neo/70 hover:text-neo" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {showDone ? "◉ DONE" : "○ DONE"}
          </button>
          <span className="ml-auto shrink-0 text-[10px] text-[var(--text-tertiary)]">
            {filtered.length} task{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Desktop: full filter bar */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); resetPage(); }}
            className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] py-1.5 pl-7 pr-3 text-[10px] text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-neo/30"
          />
        </div>

        {/* Status filter */}
        <FilterSelect
          value={filterStatus}
          onChange={(v) => { setFilterStatus(v); resetPage(); }}
          options={[
            { value: "all", label: "All statuses" },
            ...STATUS_ORDER.map((s) => ({ value: s, label: statusLabels[s] })),
          ]}
          placeholder="STATUS"
        />

        {/* Project filter */}
        <FilterSelect
          value={filterProject}
          onChange={(v) => { setFilterProject(v); resetPage(); }}
          options={[
            { value: "all", label: "All projects" },
            { value: "none", label: "No project" },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
          placeholder="PROJECT"
        />

        {/* Assignee filter */}
        <FilterSelect
          value={filterAssignee}
          onChange={(v) => { setFilterAssignee(v); resetPage(); }}
          options={[
            { value: "all", label: "All assignees" },
            { value: "unassigned", label: "Unassigned" },
            ...assigneeOptions.agentIds.map((id) => ({
              value: id,
              label: `${agentMap.get(id)?.emoji ?? ""} ${agentMap.get(id)?.callsign ?? id}`,
            })),
            ...assigneeOptions.humans.map((h) => ({ value: h, label: `👤 ${h}` })),
          ]}
          placeholder="ASSIGNEE"
        />

        {/* Priority filter */}
        <FilterSelect
          value={filterPriority}
          onChange={(v) => { setFilterPriority(v); resetPage(); }}
          options={[
            { value: "all", label: "All priorities" },
            { value: "critical", label: "Critical" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ]}
          placeholder="PRIORITY"
        />

        {/* Show done toggle */}
        <button
          onClick={() => { setShowDone((v) => !v); resetPage(); }}
          className={`text-[10px] tracking-wider transition-colors ${
            showDone ? "text-neo/70 hover:text-neo" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
        >
          {showDone ? "◉ DONE SHOWN" : "○ SHOW DONE"}
        </button>

        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
          {filtered.length} task{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neo/20 bg-neo/5 px-3 py-2">
          <span className="text-[10px] text-neo/70">
            {selected.size} selected
          </span>
          <div className="h-3 w-px bg-[var(--border-medium)]" />

          {/* Action selector */}
          <FilterSelect
            value={bulkAction}
            onChange={setBulkAction}
            options={[
              { value: "", label: "Choose action..." },
              { value: "assign", label: "Assign agent" },
              { value: "status", label: "Change status" },
              { value: "priority", label: "Change priority" },
              { value: "archive", label: "Archive (→ Done)" },
              { value: "delete", label: "Delete" },
            ]}
            placeholder="ACTION"
          />

          {bulkAction === "assign" && (
            <FilterSelect
              value={bulkAssignee}
              onChange={setBulkAssignee}
              options={[
                { value: "", label: "Unassigned" },
                ...agents.map((a) => ({ value: a.id, label: `${a.emoji} ${a.callsign}` })),
              ]}
              placeholder="AGENT"
            />
          )}

          {bulkAction === "status" && (
            <FilterSelect
              value={bulkStatus}
              onChange={(v) => setBulkStatus(v as TaskStatus)}
              options={STATUS_ORDER.map((s) => ({ value: s, label: statusLabels[s] }))}
              placeholder="STATUS"
            />
          )}

          {bulkAction === "priority" && (
            <FilterSelect
              value={bulkPriority}
              onChange={(v) => setBulkPriority(v as TaskPriority)}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
              placeholder="PRIORITY"
            />
          )}

          {bulkAction && (
            <button
              onClick={applyBulkAction}
              disabled={bulkLoading}
              className={`rounded-lg px-3 py-1 text-[10px] tracking-wider transition-all ${
                bulkAction === "delete"
                  ? "border border-red-500/30 text-red-400 hover:bg-red-400/10"
                  : "border border-neo/30 text-[var(--accent)] hover:bg-neo/10"
              } disabled:opacity-30`}
            >
              {bulkLoading ? "APPLYING..." : "APPLY"}
            </button>
          )}

          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            CLEAR
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-medium)] bg-[var(--bg-surface)]">
              <th className="w-8 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  className="h-3 w-3 cursor-pointer rounded accent-[#00f0ff]"
                />
              </th>
              <TH label="TITLE" col="title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="STATUS" col="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="PRIORITY" col="priority" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="PROJECT" col="project" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="ASSIGNEE" col="assignee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="CREATED" col="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <TH label="UPDATED" col="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-[var(--text-tertiary)]">
                  No tasks match your filters
                </td>
              </tr>
            )}
            {paginated.map((task) => {
              const isSelected = selected.has(task.id);
              const agent = task.assignedAgentId ? agentMap.get(task.assignedAgentId) : null;
              const project = task.projectId ? projectMap.get(task.projectId) : null;
              const ps = priorityStyles[task.priority] ?? priorityStyles.medium;

              return (
                <tr
                  key={task.id}
                  className={`group border-b border-[var(--border-subtle)] transition-colors ${
                    isSelected
                      ? "bg-neo/5"
                      : "hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(task.id)}
                      className="h-3 w-3 cursor-pointer rounded accent-[#00f0ff]"
                    />
                  </td>

                  {/* Title */}
                  <td
                    className="max-w-[280px] cursor-pointer px-3 py-2"
                    onClick={() => onTaskClick(task)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 py-0.5 font-mono text-[8px] tracking-wider text-[var(--text-tertiary)]">
                        TSK-{String(task.shortId).padStart(4, "0")}
                      </span>
                      <span className="truncate text-[11px] text-[var(--text-primary)] group-hover:text-[var(--text-primary)] transition-colors">
                        {task.title}
                      </span>
                      {task.source && task.source !== "manual" && (() => {
                        const s = sourceStyles[task.source as TaskSource] ?? sourceStyles.manual;
                        return (
                          <span className={`shrink-0 rounded-full border px-1.5 py-0 font-mono text-[7px] uppercase tracking-wider ${s.cls}`}>
                            {s.label}
                          </span>
                        );
                      })()}
                    </div>
                  </td>

                  {/* Status — inline editable */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={task.status}
                      onChange={(e) => inlineUpdate(task.id, "status", e.target.value)}
                      className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-2 py-1 text-[9px] tracking-wider outline-none focus:border-neo/30 cursor-pointer"
                      style={{ color: statusColors[task.status as TaskStatus] ?? "#fff" }}
                    >
                      {STATUS_ORDER.map((s) => (
                        <option
                          key={s}
                          value={s}
                          style={{
                            color: statusColors[s],
                            backgroundColor: "#12121a",
                          }}
                        >
                          {statusLabels[s]}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Priority — inline editable */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={task.priority}
                      onChange={(e) => inlineUpdate(task.id, "priority", e.target.value)}
                      className={`rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-[9px] uppercase tracking-wider outline-none focus:border-neo/30 cursor-pointer ${ps.text} ${ps.bg}`}
                    >
                      {["low", "medium", "high", "critical"].map((p) => (
                        <option
                          key={p}
                          value={p}
                          style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.6)" }}
                        >
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Project */}
                  <td className="px-3 py-2">
                    {project ? (() => {
                      const projectColor = project.color || "#00f0ff";
                      return (
                        <span 
                          className="rounded-full border px-2 py-0.5 text-[9px] tracking-wider"
                          style={{ 
                            borderColor: `${projectColor}30`,
                            backgroundColor: `${projectColor}15`,
                            color: projectColor,
                          }}
                        >
                          📁 {project.name}
                        </span>
                      );
                    })() : (
                      <span className="text-[10px] text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>

                  {/* Assignee — inline editable */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                      <select
                        value={task.assignedAgentId || ""}
                        onChange={(e) =>
                          inlineUpdate(task.id, "assignedAgentId", e.target.value || null)
                        }
                        className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-2 py-1 text-[9px] tracking-wider outline-none focus:border-neo/30 cursor-pointer"
                        style={{
                          color: agent?.color ?? "rgba(255,255,255,0.3)",
                        }}
                      >
                        <option value="" style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.3)" }}>
                          ⊘ Unassigned
                        </option>
                        {agents.map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                            style={{ color: a.color, backgroundColor: "#12121a" }}
                          >
                            {a.emoji} {a.callsign}
                          </option>
                        ))}
                      </select>
                      {task.humanAssignee && (
                        <span className="flex items-center gap-1 rounded border border-red-400/20 bg-red-400/5 px-1.5 py-0.5 text-[8px] text-red-400/70 w-fit">
                          👤 {task.humanAssignee}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Created */}
                  <td className="px-3 py-2">
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {formatDate(task.createdAt)}
                    </span>
                  </td>

                  {/* Updated */}
                  <td className="px-3 py-2">
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {formatDate(task.updatedAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Page {page + 1} of {totalPages} · {filtered.length} tasks
          </span>
          <div className="flex items-center gap-1">
            <PagBtn
              label="«"
              onClick={() => setPage(0)}
              disabled={page === 0}
            />
            <PagBtn
              label="‹"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            />
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show pages around current
              let pageNum = i;
              if (totalPages > 7) {
                const start = Math.max(0, Math.min(page - 3, totalPages - 7));
                pageNum = start + i;
              }
              return (
                <PagBtn
                  key={pageNum}
                  label={String(pageNum + 1)}
                  onClick={() => setPage(pageNum)}
                  active={pageNum === page}
                />
              );
            })}
            <PagBtn
              label="›"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
            />
            <PagBtn
              label="»"
              onClick={() => setPage(totalPages - 1)}
              disabled={page === totalPages - 1}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TH({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left text-[9px] tracking-[0.15em] transition-colors ${
        active ? "text-neo/70" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
      onClick={() => onSort(col)}
    >
      {label}
      {active ? (
        <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "↑" : "↓"}</span>
      ) : (
        <span className="ml-1 text-[var(--text-tertiary)]">↕</span>
      )}
    </th>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  compact?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`appearance-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-secondary)] tracking-wider outline-none transition-all focus:border-neo/30 cursor-pointer ${
        compact
          ? "px-2 py-1.5 pr-5 text-[10px] text-[var(--text-secondary)] shrink-0"
          : "px-2.5 py-1.5 pr-6 text-[10px] text-[var(--text-secondary)]"
      }`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 6px center",
      }}
    >
      {options.map((o) => (
        <option
          key={o.value}
          value={o.value}
          style={{ backgroundColor: "#12121a", color: "rgba(255,255,255,0.6)" }}
        >
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PagBtn({
  label,
  onClick,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 items-center justify-center rounded text-[10px] transition-all ${
        active
          ? "bg-neo/20 text-[var(--accent)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-20"
      }`}
    >
      {label}
    </button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHrs === 0) {
      const diffMin = Math.floor(diffMs / (1000 * 60));
      return diffMin <= 1 ? "just now" : `${diffMin}m ago`;
    }
    return `${diffHrs}h ago`;
  }
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
