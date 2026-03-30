import type { Agent } from "@/lib/data";
import { AgentCard } from "./agent-card";

interface AgentStatusPanelProps {
  agents: Agent[];
}

export function AgentStatusPanel({ agents }: AgentStatusPanelProps) {
  const sortedAgents = [...agents].sort((a, b) => {
    const order = { working: 0, online: 1, idle: 2, offline: 3 };
    return order[a.status] - order[b.status];
  });

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs tracking-[0.2em] text-white/40 uppercase">
          Agent Status
        </h2>
        <div className="flex items-center gap-4">
          <StatusLegend label="Online" dotClass="status-dot-online" />
          <StatusLegend label="Working" dotClass="status-dot-working" />
          <StatusLegend label="Idle" dotClass="status-dot-idle" />
          <StatusLegend label="Offline" dotClass="status-dot-offline" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedAgents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  );
}

function StatusLegend({
  label,
  dotClass,
}: {
  label: string;
  dotClass: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`status-dot ${dotClass}`} />
      <span className="font-mono text-[10px] text-white/30">{label}</span>
    </div>
  );
}
