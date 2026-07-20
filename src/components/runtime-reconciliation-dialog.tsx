"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

type ReconciliationAgent = {
  id: string;
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  status: string;
  runtimeRef: string | null;
  dmCount: number;
};

type ReconciliationPreview = {
  runtime: {
    id: string;
    name: string;
    runtimeType: string;
    status: string;
  };
  workspace: {
    id: string;
    name: string;
  };
  current: ReconciliationAgent[];
  suggested: ReconciliationAgent[];
  unbound: ReconciliationAgent[];
  otherRuntimeCount: number;
  summary: {
    activeAgents: number;
    suggestedAgents: number;
    unboundAgents: number;
    affectedDms: number;
  };
};

type ReconciliationResult = {
  archivedAgents: number;
  archivedDms: number;
  messagesDeleted: number;
};

type RuntimeReconciliationDialogProps = {
  runtimeId: string;
  runtimeName: string;
  onClose: () => void;
  onComplete: (result: ReconciliationResult) => void;
};

export function RuntimeReconciliationDialog({
  runtimeId,
  runtimeName,
  onClose,
  onComplete,
}: RuntimeReconciliationDialogProps) {
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isApplying, startApplying] = useTransition();

  useEffect(() => {
    const controller = new AbortController();

    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/reconcile`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to preview reconciliation");

        const nextPreview = data as ReconciliationPreview;
        setPreview(nextPreview);
        setSelectedIds(new Set(nextPreview.suggested.map((agent) => agent.id)));
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Failed to preview reconciliation");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadPreview();
    return () => controller.abort();
  }, [runtimeId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isApplying) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isApplying, onClose]);

  const selectableAgents = useMemo(
    () => preview ? [...preview.suggested, ...preview.unbound] : [],
    [preview],
  );
  const selectedAgents = useMemo(
    () => selectableAgents.filter((agent) => selectedIds.has(agent.id)),
    [selectableAgents, selectedIds],
  );
  const selectedDmCount = selectedAgents.reduce((total, agent) => total + agent.dmCount, 0);

  function toggleAgent(agentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function applyReconciliation() {
    if (selectedIds.size === 0 || isApplying) return;

    startApplying(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/reconcile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentIds: Array.from(selectedIds) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to reconcile runtime");
        onComplete(data as ReconciliationResult);
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : "Failed to reconcile runtime");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isApplying) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-reconciliation-title"
        className="flex max-h-[min(92dvh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-[var(--accent)]">RUNTIME ROSTER</p>
            <h2 id="runtime-reconciliation-title" className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
              Reconcile {runtimeName}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Keep current agents active and archive obsolete workspace entries without deleting history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            aria-label="Close reconciliation"
            className="rounded-lg border border-[var(--border-medium)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {loading ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-sm text-[var(--text-secondary)]">
              Comparing the workspace roster with this runtime…
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {!loading && preview ? (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                <SummaryCard label="Current" value={preview.summary.activeAgents} tone="active" />
                <SummaryCard label="Suggested" value={preview.summary.suggestedAgents} tone="suggested" />
                <SummaryCard label="Review" value={preview.summary.unboundAgents} tone="neutral" />
              </div>

              <AgentSection
                title="Kept active"
                description="These agents are currently bound to this runtime."
                agents={preview.current}
                mode="current"
                selectedIds={selectedIds}
                onToggle={toggleAgent}
              />

              {preview.suggested.length > 0 ? (
                <AgentSection
                  title="Recommended to archive"
                  description="These agents retained a runtime identity but no longer have a runtime binding."
                  agents={preview.suggested}
                  mode="selectable"
                  selectedIds={selectedIds}
                  onToggle={toggleAgent}
                />
              ) : null}

              {preview.unbound.length > 0 ? (
                <AgentSection
                  title="Unbound or manually created"
                  description="Older databases cannot distinguish these automatically. Select only agents that no longer exist on your runtime."
                  agents={preview.unbound}
                  mode="selectable"
                  selectedIds={selectedIds}
                  onToggle={toggleAgent}
                  caution
                />
              ) : null}

              {selectableAgents.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
                  This workspace is already aligned with the runtime. No reconciliation is needed.
                </div>
              ) : null}

              {preview.otherRuntimeCount > 0 ? (
                <p className="text-xs text-[var(--text-tertiary)]">
                  {preview.otherRuntimeCount} agent{preview.otherRuntimeCount === 1 ? " is" : "s are"} linked to another runtime and excluded from this reconciliation.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--text-secondary)]">
              {selectedIds.size > 0
                ? `${selectedIds.size} agent${selectedIds.size === 1 ? "" : "s"} selected · up to ${selectedDmCount} active DM${selectedDmCount === 1 ? "" : "s"} archived · 0 messages deleted`
                : "Select obsolete agents to continue. No messages will be deleted."}
            </p>
            <div className="flex gap-2 sm:shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isApplying}
                className="flex-1 rounded-xl border border-[var(--border-medium)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50 sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyReconciliation}
                disabled={selectedIds.size === 0 || isApplying || loading}
                className="flex-1 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-black disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
              >
                {isApplying ? "Reconciling…" : `Archive ${selectedIds.size || "selected"}`}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "active" | "suggested" | "neutral";
}) {
  const toneClass = tone === "active"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
    : tone === "suggested"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
      : "border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)]";

  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider opacity-75">{label}</p>
    </div>
  );
}

function AgentSection({
  title,
  description,
  agents,
  mode,
  selectedIds,
  onToggle,
  caution = false,
}: {
  title: string;
  description: string;
  agents: ReconciliationAgent[];
  mode: "current" | "selectable";
  selectedIds: Set<string>;
  onToggle: (agentId: string) => void;
  caution?: boolean;
}) {
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className={`mt-0.5 text-xs ${caution ? "text-amber-200/80" : "text-[var(--text-tertiary)]"}`}>{description}</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {agents.map((agent, index) => {
          const selected = selectedIds.has(agent.id);
          return (
            <label
              key={agent.id}
              className={`flex items-center gap-3 px-3 py-3 ${index > 0 ? "border-t border-[var(--border-subtle)]" : ""} ${mode === "selectable" ? "cursor-pointer hover:bg-[var(--bg-surface-hover)]" : ""}`}
            >
              {mode === "selectable" ? (
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(agent.id)}
                  className="h-4 w-4 rounded border-[var(--border-medium)] accent-[var(--accent)]"
                />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-300">✓</span>
              )}
              <span className="text-lg" aria-hidden="true">{agent.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{agent.callsign}</span>
                <span className="block truncate text-xs text-[var(--text-tertiary)]">{agent.title || agent.name}</span>
              </span>
              <span className="text-right text-[10px] text-[var(--text-tertiary)]">
                {agent.dmCount > 0 ? `${agent.dmCount} DM${agent.dmCount === 1 ? "" : "s"}` : "No DMs"}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
