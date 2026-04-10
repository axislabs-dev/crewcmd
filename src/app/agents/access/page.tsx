"use client";

import { useEffect, useState } from "react";

type AgentVisibility = "private" | "team" | "org";

type AgentSummary = {
  id: string;
  callsign: string;
  name: string;
  emoji: string;
  role: string;
  ownerType?: "user" | "company";
  visibility?: AgentVisibility;
};

const badgeClass: Record<AgentVisibility, string> = {
  private: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  team: "text-green-400 border-green-400/40 bg-green-400/10",
  org: "text-violet-400 border-violet-400/40 bg-violet-400/10",
};

export default function AgentAccessPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/agents");
        const data = await res.json();
        setAgents((data.agents || []) as AgentSummary[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Agent access</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            CrewCmd v1 uses ownership + visibility instead of ad-hoc per-user grants. Personal agents stay private.
            Use org-owned agents when you need team or org sharing.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-[var(--text-primary)]">Private</strong>: creator-only for personal agents; org-private for org-owned agents.</li>
            <li><strong className="text-[var(--text-primary)]">Team</strong>: org contributors (`owner/admin/member`).</li>
            <li><strong className="text-[var(--text-primary)]">Org</strong>: every org member, including viewers.</li>
            <li>Direct per-user sharing is intentionally disabled in v1 until approval/admin mediation exists.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Accessible agents
          </div>
          {loading ? (
            <div className="p-4 text-sm text-[var(--text-tertiary)]">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-tertiary)]">No accessible agents found.</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{agent.emoji} {agent.name} <span className="font-mono text-xs text-[var(--text-tertiary)]">{agent.callsign}</span></div>
                    <div className="text-xs text-[var(--text-tertiary)]">{agent.ownerType === "company" ? "Org-owned" : "Personal"} · {agent.role}</div>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${badgeClass[agent.visibility ?? "private"]}`}>
                    {agent.visibility ?? "private"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
