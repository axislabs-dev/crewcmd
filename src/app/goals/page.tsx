"use client";

import { useState, useEffect, useCallback } from "react";

interface Goal {
  id: string;
  companyId: string;
  parentGoalId: string | null;
  title: string;
  description: string | null;
  status: string;
  ownerAgentId: string | null;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
}

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400",
  completed: "bg-blue-500/20 text-blue-400",
  paused: "bg-amber-500/20 text-amber-400",
  cancelled: "bg-red-500/20 text-red-400",
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formParentId, setFormParentId] = useState<string>("");
  const [formStatus, setFormStatus] = useState("active");
  const [saving, setSaving] = useState(false);

  const fetchGoals = useCallback(async (cId: string) => {
    try {
      const res = await fetch(`/api/goals?company_id=${cId}`);
      if (res.ok) {
        setGoals(await res.json());
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
    if (cId) {
      fetchGoals(cId);
    } else {
      setLoading(false);
    }
  }, [fetchGoals]);

  function openCreate(parentId?: string) {
    setEditingGoal(null);
    setFormTitle("");
    setFormDescription("");
    setFormParentId(parentId || "");
    setFormStatus("active");
    setShowModal(true);
  }

  function openEdit(goal: Goal) {
    setEditingGoal(goal);
    setFormTitle(goal.title);
    setFormDescription(goal.description || "");
    setFormParentId(goal.parentGoalId || "");
    setFormStatus(goal.status);
    setShowModal(true);
  }

  async function handleSave() {
    if (!companyId || !formTitle.trim()) return;
    setSaving(true);

    try {
      if (editingGoal) {
        const res = await fetch(`/api/goals/${editingGoal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle,
            description: formDescription || null,
            parentGoalId: formParentId || null,
            status: formStatus,
          }),
        });
        if (res.ok) {
          setShowModal(false);
          fetchGoals(companyId);
        }
      } else {
        const res = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            title: formTitle,
            description: formDescription || null,
            parentGoalId: formParentId || null,
            status: formStatus,
          }),
        });
        if (res.ok) {
          setShowModal(false);
          fetchGoals(companyId);
        }
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(goalId: string) {
    try {
      await fetch(`/api/goals/${goalId}`, { method: "DELETE" });
      if (companyId) fetchGoals(companyId);
    } catch {
      // ignore
    }
  }

  // Build tree structure
  function buildTree(parentId: string | null): Goal[] {
    return goals
      .filter((g) => g.parentGoalId === parentId)
      .sort((a, b) => a.sortIndex - b.sortIndex);
  }

  function GoalNode({ goal, depth }: { goal: Goal; depth: number }) {
    const children = buildTree(goal.id);
    return (
      <div>
        <div
          className="group flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
          style={{ marginLeft: depth * 24 }}
        >
          {/* Connector line for children */}
          {depth > 0 && (
            <div className="mt-2 h-px w-3 bg-[var(--bg-tertiary)]" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-primary)]">{goal.title}</span>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[8px] tracking-wider ${statusColors[goal.status] || statusColors.active}`}>
                {goal.status.toUpperCase()}
              </span>
            </div>
            {goal.description && (
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)] line-clamp-2">
                {goal.description}
              </p>
            )}
            {goal.ownerAgentId && (
              <p className="mt-1 font-mono text-[9px] text-[var(--text-tertiary)]">
                Owner: {goal.ownerAgentId}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => openCreate(goal.id)}
              className="rounded p-1 font-mono text-[9px] text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              title="Add sub-goal"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              onClick={() => openEdit(goal)}
              className="rounded p-1 font-mono text-[9px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              title="Edit"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button
              onClick={() => handleDelete(goal.id)}
              className="rounded p-1 font-mono text-[9px] text-red-400/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="Delete"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>

        {children.length > 0 && (
          <div className="mt-1 space-y-1">
            {children.map((child) => (
              <GoalNode key={child.id} goal={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
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
            Select a company from the sidebar to view goals.
          </p>
        </div>
      </div>
    );
  }

  const rootGoals = buildTree(null);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-wider text-[var(--accent)]">GOALS</h1>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Company mission &rarr; Project goals &rarr; Agent goals &rarr; Tasks
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
        >
          + NEW GOAL
        </button>
      </div>

      <div className="mt-6 space-y-2">
        {rootGoals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-medium)] py-12 text-center">
            <p className="text-xs text-[var(--text-tertiary)]">No goals yet</p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Create your first goal to define your company&apos;s direction.
            </p>
            <button
              onClick={() => openCreate()}
              className="mt-4 rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              CREATE FIRST GOAL
            </button>
          </div>
        ) : (
          rootGoals.map((goal) => (
            <GoalNode key={goal.id} goal={goal} depth={0} />
          ))
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] p-6 shadow-2xl">
            <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--accent)]">
              {editingGoal ? "EDIT GOAL" : "NEW GOAL"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">TITLE</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">PARENT GOAL</label>
                <select
                  value={formParentId}
                  onChange={(e) => setFormParentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                >
                  <option value="">None (root goal)</option>
                  {goals
                    .filter((g) => g.id !== editingGoal?.id)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </select>
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
                disabled={saving || !formTitle.trim()}
                className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
              >
                {saving ? "SAVING..." : editingGoal ? "UPDATE" : "CREATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
