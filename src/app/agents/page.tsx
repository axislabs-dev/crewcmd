"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentCard } from "@/components/agent-card";
import { NewAgentDialog } from "@/components/new-agent-dialog";
import { AdapterCheck } from "@/components/adapter-check";
import { AgentRuntimeBadge } from "@/components/agent-runtime-badge";
import { TaskDialog } from "@/components/task-dialog";
import type { Agent, AgentStatus } from "@/lib/data";

const statusFilters: { key: AgentStatus | "all"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "online", label: "ONLINE" },
  { key: "working", label: "WORKING" },
  { key: "idle", label: "IDLE" },
  { key: "offline", label: "OFFLINE" },
];

function getCompanyId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_company=([^;]*)/);
  return match ? match[1] : null;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [taskAgent, setTaskAgent] = useState<Agent | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      /* empty */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = agents.filter((agent) => {
    if (statusFilter !== "all" && agent.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        agent.callsign.toLowerCase().includes(q) ||
        agent.name.toLowerCase().includes(q) ||
        agent.title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = agents.filter(
    (a) => a.status === "online" || a.status === "working"
  ).length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
              AGENTS
            </h1>
            <p className="text-[11px] tracking-wider text-[var(--text-tertiary)]">
              {agents.length > 0
                ? `${activeCount} OF ${agents.length} ACTIVE`
                : "NO AGENTS DETECTED"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            <button
              onClick={() => setShowNewAgent(true)}
              className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              + NEW AGENT
            </button>
          </div>
        </div>

        {/* Adapter availability banner */}
        <AdapterCheck />

        <div className="flex flex-wrap gap-2">
          {statusFilters.map((sf) => (
            <button
              key={sf.key}
              onClick={() => setStatusFilter(sf.key)}
              className={`rounded-lg px-3 py-1.5 text-[11px] tracking-wider transition-all duration-200 ${
                statusFilter === sf.key
                  ? "bg-neo/15 text-[var(--accent)]"
                  : "border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {sf.label}
              {sf.key !== "all" && (
                <span className="ml-1.5 text-[var(--text-tertiary)]">
                  {agents.filter((a) => a.status === sf.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {agents.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agent) => (
              <div key={agent.id} className="group/card relative">
                <AgentCard agent={agent} />
                {/* Runtime badge overlay */}
                <div className="absolute right-3 bottom-10 z-10">
                  <AgentRuntimeBadge callsign={agent.callsign.toLowerCase()} onStartStop={refresh} />
                </div>
                {/* Assign task button on hover */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTaskAgent(agent);
                  }}
                  className="absolute left-3 bottom-10 z-10 rounded bg-[var(--accent-soft)] px-2 py-1 text-[11px] tracking-wider text-[var(--accent)] opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-[var(--accent-medium)]"
                >
                  ASSIGN TASK
                </button>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-12 text-center">
                <p className="text-xs text-[var(--text-tertiary)]">
                  No agents match the current filters
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card flex flex-col items-center justify-center py-16">
            <p className="text-sm text-[var(--text-tertiary)]">
              No agents detected
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Create your first agent to get started
            </p>
            <button
              onClick={() => setShowNewAgent(true)}
              className="mt-4 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              + NEW AGENT
            </button>
          </div>
        )}
      </div>

      {showNewAgent && (
        <NewAgentDialog
          companyId={getCompanyId()}
          onCreated={() => {
            setShowNewAgent(false);
            refresh();
          }}
          onClose={() => setShowNewAgent(false)}
        />
      )}

      {taskAgent && (
        <TaskDialog
          agent={taskAgent}
          onClose={() => setTaskAgent(null)}
        />
      )}
    </div>
  );
}
