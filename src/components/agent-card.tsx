import Link from "next/link";
import type { Agent } from "@/lib/data";
import { timeAgo } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
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

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link
      href={`/agents/${agent.callsign.toLowerCase()}`}
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
              <p className="text-xs text-white/40">{agent.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className={`status-dot status-dot-${agent.status}`} />
            <span className="font-mono text-[10px] tracking-wider text-white/50">
              {statusLabels[agent.status]}
            </span>
          </div>
        </div>

        {agent.currentTask && (
          <div className="mb-3 rounded-lg bg-white/[0.03] px-3 py-2">
            <span className="font-mono text-[10px] tracking-wider text-white/30">
              CURRENT TASK
            </span>
            <p className="mt-0.5 text-xs text-white/70 line-clamp-2">
              {agent.currentTask}
            </p>
          </div>
        )}

        {agent.tokenUsage && agent.tokenUsage.sessionCount > 0 && (
          <div className="mb-3 rounded-lg bg-white/[0.03] px-3 py-2">
            <span className="font-mono text-[10px] tracking-wider text-white/30">
              TOKENS (RECENT)
            </span>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-white/70">
              <span>
                {agent.tokenUsage.totalTokens.toLocaleString()} tokens
              </span>
              <span className="opacity-30">•</span>
              <span>{agent.tokenUsage.sessionCount} sessions</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-white/25">
            {timeAgo(agent.lastActive)}
          </span>
          <span
            className="font-mono text-[10px] tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: agent.color }}
          >
            VIEW PROFILE &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}
