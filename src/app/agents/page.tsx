"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentCard } from "@/components/agent-card";
import type { Agent, AgentStatus } from "@/lib/data";

const statusFilters: { key: AgentStatus | "all"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "online", label: "ONLINE" },
  { key: "working", label: "WORKING" },
  { key: "idle", label: "IDLE" },
  { key: "offline", label: "OFFLINE" },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/agents");
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
            <h1 className="font-mono text-lg font-bold tracking-[0.15em] text-white/80">
              AGENTS
            </h1>
            <p className="font-mono text-[10px] tracking-wider text-white/30">
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
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/70 placeholder-white/20 outline-none transition-colors focus:border-neo/30"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {statusFilters.map((sf) => (
            <button
              key={sf.key}
              onClick={() => setStatusFilter(sf.key)}
              className={`rounded-lg px-3 py-1.5 font-mono text-[10px] tracking-wider transition-all duration-200 ${
                statusFilter === sf.key
                  ? "bg-neo/15 text-neo"
                  : "border border-white/[0.06] text-white/30 hover:bg-white/[0.04] hover:text-white/50"
              }`}
            >
              {sf.label}
              {sf.key !== "all" && (
                <span className="ml-1.5 text-white/20">
                  {agents.filter((a) => a.status === sf.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {agents.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-12 text-center">
                <p className="font-mono text-xs text-white/20">
                  No agents match the current filters
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card flex flex-col items-center justify-center py-16">
            <p className="font-mono text-sm text-white/30">
              No agents detected
            </p>
            <p className="mt-1 font-mono text-[10px] text-white/15">
              Connect OpenClaw to see your team
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
