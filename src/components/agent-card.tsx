import Link from "next/link";
import type { Agent } from "@/lib/data";
import { timeAgo } from "@/lib/utils";

export interface AgentSkillBadge {
  slug: string;
  name: string;
  icon: string;
}

interface AgentCardProps {
  agent: Agent;
  skills?: AgentSkillBadge[];
}

const glowTextClass: Record<string, string> = {
  "#00f0ff": "glow-text-neo",
  "#f0ff00": "glow-text-cipher",
  "#ff6600": "glow-text-havoc",
  "#00ff88": "glow-text-pulse",
  "#ff00aa": "glow-text-razor",
  "#ff4444": "glow-text-maverick",
  "#aa88ff": "glow-text-ghost",
  "#88ff00": "glow-text-viper",
};

const statusLabels: Record<string, string> = {
  online: "ONLINE",
  working: "WORKING",
  idle: "IDLE",
  offline: "OFFLINE",
};

const adapterLabels: Record<string, string> = {
  claude_local: "CLAUDE",
  codex_local: "CODEX",
  gemini_local: "GEMINI",
  opencode_local: "OPENCODE",
  openclaw_gateway: "OPENCLAW",
  cursor: "CURSOR",
  pi_local: "PI",
  process: "PROCESS",
  http: "HTTP",
};

export function AgentCard({ agent, skills }: AgentCardProps) {
  return (
    <Link
      href="/team"
      className="glass-card glass-card-hover group relative block overflow-hidden p-4 transition-all duration-300"
      style={{
        borderColor: `${agent.color}15`,
      }}
    >
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(ellipse at top, ${agent.color}08, transparent 70%)`,
        }}
      />

      <div className="relative">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{agent.emoji}</span>
            <div>
              <h3
                className={`font-mono text-sm font-bold tracking-wider ${glowTextClass[agent.color] ?? ""}`}
                style={{ color: agent.color }}
              >
                {agent.callsign.toUpperCase()}
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">{agent.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className={`status-dot status-dot-${agent.status}`} />
            <span className="text-[11px] tracking-wider text-[var(--text-secondary)]">
              {statusLabels[agent.status]}
            </span>
          </div>
        </div>

        {/* Adapter type and role badges */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)]">
            {adapterLabels[agent.adapterType] || agent.adapterType.toUpperCase()}
          </span>
          {agent.role && agent.role !== "custom" && (
            <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)]">
              {agent.role.toUpperCase()}
            </span>
          )}
          {agent.model && (
            <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
              {agent.model}
            </span>
          )}
        </div>

        {skills && skills.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {skills.map((s) => (
              <span
                key={s.slug}
                className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--accent)]"
                title={s.name}
              >
                <span className="text-[10px] leading-none">{s.icon}</span>
                {s.name}
              </span>
            ))}
          </div>
        )}

        {agent.currentTask && (
          <div className="mb-3 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
            <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
              CURRENT TASK
            </span>
            <p className="mt-0.5 text-xs text-[var(--text-primary)] line-clamp-2">
              {agent.currentTask}
            </p>
          </div>
        )}

        {agent.tokenUsage && agent.tokenUsage.sessionCount > 0 && (
          <div className="mb-3 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
            <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
              TOKENS (RECENT)
            </span>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <span>
                {agent.tokenUsage.totalTokens.toLocaleString()} tokens
              </span>
              <span className="opacity-30">&bull;</span>
              <span>{agent.tokenUsage.sessionCount} sessions</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {timeAgo(agent.lastActive)}
          </span>
          <span
            className="text-[10px] tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: agent.color }}
          >
            VIEW PROFILE &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}
