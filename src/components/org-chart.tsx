import Link from "next/link";
import type { Agent } from "@/lib/data";

interface OrgChartProps {
  agents: Agent[];
}

export function OrgChart({ agents }: OrgChartProps) {
  const neo = agents.find((a) => a.callsign === "Neo");
  const cipher = agents.find((a) => a.callsign === "Cipher");
  const havoc = agents.find((a) => a.callsign === "Havoc");
  const maverick = agents.find((a) => a.callsign === "Maverick");
  const havocReports = agents.filter((a) => a.reportsTo === "agent-havoc");
  const cipherReports = agents.filter((a) => a.reportsTo === "agent-cipher");
  const maverickReports = agents.filter((a) => a.reportsTo === "agent-maverick");

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-mono text-xs tracking-[0.2em] text-white/40 uppercase">
          Org Chart
        </h2>
      </div>

      <div className="glass-card overflow-x-auto p-6">
        <div className="flex flex-col items-center gap-0 min-w-[700px]">
          <OrgNode
            emoji="\ud83c\udf1f"
            callsign="ROGER"
            title="Commander / Founder"
            color="#ffffff"
            isCommander
          />

          <VerticalLine />

          {neo && <AgentOrgNode agent={neo} />}

          <VerticalLine />

          <div className="relative flex items-start justify-center gap-24">
            <HorizontalLine />

            <div className="flex flex-col items-center">
              {cipher && <AgentOrgNode agent={cipher} />}
              {cipherReports.length > 0 && (
                <>
                  <VerticalLine />
                  <div className="relative flex items-start justify-center gap-8">
                    <HorizontalLineSm count={cipherReports.length} />
                    {cipherReports.map((agent) => (
                      <div key={agent.id} className="flex flex-col items-center">
                        <VerticalLineShort />
                        <AgentOrgNode agent={agent} compact />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col items-center">
              {maverick && <AgentOrgNode agent={maverick} />}
              {maverickReports.length > 0 && (
                <>
                  <VerticalLine />
                  <div className="relative flex items-start justify-center gap-8">
                    <HorizontalLineSm count={maverickReports.length} />
                    {maverickReports.map((agent) => (
                      <div key={agent.id} className="flex flex-col items-center">
                        <VerticalLineShort />
                        <AgentOrgNode agent={agent} compact />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col items-center">
              {havoc && <AgentOrgNode agent={havoc} />}

              {havocReports.length > 0 && (
                <>
                  <VerticalLine />
                  <div className="relative flex items-start justify-center gap-8">
                    <HorizontalLineSm count={havocReports.length} />
                    {havocReports.map((agent) => (
                      <div key={agent.id} className="flex flex-col items-center">
                        <VerticalLineShort />
                        <AgentOrgNode agent={agent} compact />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentOrgNode({
  agent,
  compact,
}: {
  agent: Agent;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/agents/${agent.callsign.toLowerCase()}`}
      className="group flex flex-col items-center transition-transform duration-200 hover:scale-105"
    >
      <div
        className={`flex flex-col items-center rounded-xl border border-white/[0.08] bg-white/[0.03] transition-all duration-300 group-hover:bg-white/[0.06] ${
          compact ? "px-3 py-2" : "px-5 py-3"
        }`}
        style={{
          boxShadow: `0 0 0 1px ${agent.color}15`,
        }}
      >
        <span className={compact ? "text-lg" : "text-2xl"}>{agent.emoji}</span>
        <span
          className={`font-mono font-bold tracking-wider ${
            compact ? "text-[10px]" : "text-xs"
          }`}
          style={{ color: agent.color }}
        >
          {agent.callsign.toUpperCase()}
        </span>
        <span
          className={`text-center text-white/40 ${
            compact ? "max-w-[80px] text-[8px]" : "text-[10px]"
          }`}
        >
          {agent.title}
        </span>
        <div className="mt-1 flex items-center gap-1">
          <span className={`status-dot status-dot-${agent.status}`} />
        </div>
      </div>
    </Link>
  );
}

function OrgNode({
  emoji,
  callsign,
  title,
  color,
  isCommander,
}: {
  emoji: string;
  callsign: string;
  title: string;
  color: string;
  isCommander?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border bg-white/[0.03] px-5 py-3 ${
        isCommander ? "border-white/20" : "border-white/[0.08]"
      }`}
      style={{
        boxShadow: isCommander ? "0 0 20px rgba(255,255,255,0.05)" : undefined,
      }}
    >
      <span className="text-2xl">{emoji}</span>
      <span
        className="font-mono text-xs font-bold tracking-wider"
        style={{ color }}
      >
        {callsign}
      </span>
      <span className="text-[10px] text-white/40">{title}</span>
    </div>
  );
}

function VerticalLine() {
  return (
    <div className="h-8 w-px bg-gradient-to-b from-white/20 to-white/5" />
  );
}

function VerticalLineShort() {
  return (
    <div className="h-5 w-px bg-gradient-to-b from-white/15 to-white/5" />
  );
}

function HorizontalLine() {
  return (
    <div
      className="absolute top-0 left-1/2 h-px -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent"
      style={{ width: "calc(100% - 40px)" }}
    />
  );
}

function HorizontalLineSm({ count }: { count: number }) {
  return (
    <div
      className="absolute top-0 left-1/2 h-px -translate-x-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent"
      style={{ width: `${Math.max(count - 1, 1) * 80 + 40}px` }}
    />
  );
}
