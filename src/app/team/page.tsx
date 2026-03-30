"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Agent } from "@/lib/data";

// Static org structure from TEAM.md / openclaw.json
const ORG_STRUCTURE = {
  roger: {
    callsign: "Roger",
    title: "Commander / Founder",
    emoji: "🌟",
    color: "#ffffff",
    reportsTo: null,
    isHuman: true,
  },
};

type OrgLevel = {
  id: string;
  children?: string[];
};

// Org tree definition (mirrors TEAM.md)
const ORG_TREE: OrgLevel[] = [
  { id: "roger", children: ["neo"] },
  { id: "neo", children: ["cipher", "sentinel", "maverick", "havoc"] },
  {
    id: "havoc",
    children: ["pulse", "razor", "ghost", "viper"],
  },
];

export default function TeamPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const getAgent = (callsign: string) =>
    agents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());

  const activeCount = agents.filter(
    (a) => a.status === "online" || a.status === "working"
  ).length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-mono text-lg font-bold tracking-[0.15em] text-white/80">
              TEAM
            </h1>
            <p className="font-mono text-[10px] tracking-wider text-white/30">
              {loading
                ? "LOADING..."
                : `${activeCount} OF ${agents.length} ACTIVE — AXISLABS TACTICAL SQUAD`}
            </p>
          </div>
          <Link
            href="/agents"
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 font-mono text-[10px] tracking-wider text-white/30 transition-colors hover:bg-white/[0.04] hover:text-white/50"
          >
            VIEW AGENT LIST →
          </Link>
        </div>

        {/* Org Chart */}
        <div className="glass-card overflow-x-auto p-6 sm:p-8">
          <div className="flex min-w-[800px] flex-col items-center gap-0">
            {/* Roger — Commander */}
            <CommanderNode />

            <VerticalLine />

            {/* Neo */}
            {loading ? (
              <SkeletonNode />
            ) : (
              <AgentNode agent={getAgent("Neo")} fallback={{ callsign: "Neo", title: "Chief Revenue Officer", emoji: "🕶️", color: "#a78bfa" }} />
            )}

            <VerticalLine />

            {/* L2: Cipher, Sentinel, Maverick, Havoc */}
            <div className="relative flex items-start justify-center gap-8 md:gap-16">
              <HorizontalBridge width="calc(100% - 40px)" />

              {[
                { id: "Cipher", fallback: { title: "CTO & Founding Software Engineer", emoji: "⚡", color: "#00f0ff" } },
                { id: "Sentinel", fallback: { title: "Head of Quality & Code Review", emoji: "🛡️", color: "#22c55e" } },
                { id: "Maverick", fallback: { title: "CFO & Head of Quantitative Strategy", emoji: "🎰", color: "#f59e0b" } },
                { id: "Havoc", fallback: { title: "Chief Marketing Officer", emoji: "🔥", color: "#ef4444" } },
              ].map(({ id, fallback }) => (
                <div key={id} className="flex flex-col items-center">
                  <VerticalLineShort />
                  {loading ? (
                    <SkeletonNode compact />
                  ) : (
                    <AgentNode
                      agent={getAgent(id)}
                      fallback={{ callsign: id, ...fallback }}
                    />
                  )}

                  {/* Havoc's reports */}
                  {id === "Havoc" && (
                    <>
                      <VerticalLine />
                      <div className="relative flex items-start justify-center gap-4">
                        <HorizontalBridge width="calc(100% + 80px)" />
                        {[
                          { id: "Pulse", fallback: { title: "Trend Intelligence Analyst", emoji: "📡", color: "#8b5cf6" } },
                          { id: "Razor", fallback: { title: "Creative Director", emoji: "✂️", color: "#ec4899" } },
                          { id: "Ghost", fallback: { title: "Head of SEO & Content", emoji: "👻", color: "#6b7280" } },
                          { id: "Viper", fallback: { title: "Head of Growth & Outreach", emoji: "🐍", color: "#10b981" } },
                        ].map(({ id: subId, fallback: subFallback }) => (
                          <div key={subId} className="flex flex-col items-center">
                            <VerticalLineShort />
                            {loading ? (
                              <SkeletonNode compact />
                            ) : (
                              <AgentNode
                                agent={getAgent(subId)}
                                fallback={{ callsign: subId, ...subFallback }}
                                compact
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Roster Table */}
        <div className="glass-card overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-3">
            <h2 className="font-mono text-[10px] tracking-[0.2em] text-white/40 uppercase">
              Full Roster
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="px-5 py-3 text-left font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase">Agent</th>
                  <th className="px-5 py-3 text-left font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase">Title</th>
                  <th className="px-5 py-3 text-left font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase">Reports To</th>
                  <th className="px-5 py-3 text-left font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase">Status</th>
                  <th className="px-5 py-3 text-left font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {/* Roger */}
                <RosterRow
                  emoji="🌟"
                  callsign="Roger"
                  title="Commander / Founder"
                  color="#ffffff"
                  reportsTo="—"
                  status={null}
                  lastActive="Always"
                  isHuman
                />
                {loading ? (
                  Array.from({ length: 9 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-white/[0.04]" />
                      </td>
                    </tr>
                  ))
                ) : (
                  [
                    { callsign: "Neo", reportsTo: "Roger" },
                    { callsign: "Cipher", reportsTo: "Neo" },
                    { callsign: "Forge", reportsTo: "Cipher" },
                    { callsign: "Blitz", reportsTo: "Cipher" },
                    { callsign: "Sentinel", reportsTo: "Cipher" },
                    { callsign: "Maverick", reportsTo: "Neo" },
                    { callsign: "Axiom", reportsTo: "Maverick" },
                    { callsign: "Havoc", reportsTo: "Neo" },
                    { callsign: "Pulse", reportsTo: "Havoc" },
                    { callsign: "Razor", reportsTo: "Havoc" },
                    { callsign: "Ghost", reportsTo: "Havoc" },
                    { callsign: "Viper", reportsTo: "Havoc" },
                  ].map(({ callsign, reportsTo }) => {
                    const agent = getAgent(callsign);
                    return (
                      <RosterRow
                        key={callsign}
                        emoji={agent?.emoji ?? "?"}
                        callsign={callsign}
                        title={agent?.title ?? "—"}
                        color={agent?.color ?? "#ffffff"}
                        reportsTo={reportsTo}
                        status={agent?.status ?? "offline"}
                        lastActive={agent?.lastActive ?? "—"}
                        href={`/agents/${callsign.toLowerCase()}`}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Config info */}
        <div className="glass-card p-5">
          <h2 className="mb-3 font-mono text-[10px] tracking-[0.2em] text-white/40 uppercase">
            OpenClaw Config
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "MAX CONCURRENT", value: "4" },
              { label: "SUBAGENT DEPTH", value: "2" },
              { label: "MAX SUBAGENTS", value: "8" },
              { label: "CHILDREN / AGENT", value: "6" },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <p className="font-mono text-[8px] tracking-[0.2em] text-white/25 uppercase">{label}</p>
                <p className="mt-1 font-mono text-lg font-bold text-white/70">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CommanderNode() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/20 bg-white/[0.03] px-6 py-4 shadow-[0_0_20px_rgba(255,255,255,0.05)]">
      <span className="text-3xl">🌟</span>
      <span className="mt-1 font-mono text-sm font-bold tracking-wider text-white">
        ROGER
      </span>
      <span className="font-mono text-[10px] text-white/40">Commander / Founder</span>
    </div>
  );
}

function AgentNode({
  agent,
  fallback,
  compact,
}: {
  agent: Agent | undefined;
  fallback: { callsign: string; title: string; emoji: string; color: string };
  compact?: boolean;
}) {
  const callsign = agent?.callsign ?? fallback.callsign;
  const title = agent?.title ?? fallback.title;
  const emoji = agent?.emoji ?? fallback.emoji;
  const color = agent?.color ?? fallback.color;
  const status = agent?.status;

  const node = (
    <div
      className={`flex flex-col items-center rounded-xl border border-white/[0.08] bg-white/[0.03] transition-all duration-300 hover:bg-white/[0.06] ${
        compact ? "px-3 py-2" : "px-5 py-3"
      }`}
      style={{ boxShadow: `0 0 0 1px ${color}15` }}
    >
      <span className={compact ? "text-xl" : "text-2xl"}>{emoji}</span>
      <span
        className={`font-mono font-bold tracking-wider ${compact ? "text-[10px]" : "text-xs"}`}
        style={{ color }}
      >
        {callsign.toUpperCase()}
      </span>
      <span
        className={`text-center text-white/40 ${compact ? "max-w-[80px] text-[8px]" : "max-w-[100px] text-[9px]"}`}
      >
        {title}
      </span>
      {status && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className={`status-dot status-dot-${status}`} />
          <span className="font-mono text-[8px] text-white/25 uppercase">{status}</span>
        </div>
      )}
    </div>
  );

  if (agent) {
    return (
      <Link
        href={`/agents/${callsign.toLowerCase()}`}
        className="group flex flex-col items-center transition-transform duration-200 hover:scale-105"
      >
        {node}
      </Link>
    );
  }

  return <div className="flex flex-col items-center">{node}</div>;
}

function SkeletonNode({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02] ${
        compact ? "h-20 w-20" : "h-28 w-28"
      }`}
    />
  );
}

function RosterRow({
  emoji,
  callsign,
  title,
  color,
  reportsTo,
  status,
  lastActive,
  href,
  isHuman,
}: {
  emoji: string;
  callsign: string;
  title: string;
  color: string;
  reportsTo: string;
  status: Agent["status"] | null;
  lastActive: string;
  href?: string;
  isHuman?: boolean;
}) {
  const nameCell = (
    <div className="flex items-center gap-2">
      <span className="text-base">{emoji}</span>
      <span className="font-mono text-xs font-medium tracking-wider" style={{ color }}>
        {callsign.toUpperCase()}
      </span>
      {isHuman && (
        <span className="rounded px-1 py-0.5 font-mono text-[8px] tracking-wider text-white/25 border border-white/[0.06]">
          HUMAN
        </span>
      )}
    </div>
  );

  return (
    <tr className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
      <td className="px-5 py-3">
        {href ? (
          <Link href={href} className="hover:opacity-80 transition-opacity">
            {nameCell}
          </Link>
        ) : (
          nameCell
        )}
      </td>
      <td className="px-5 py-3 font-mono text-[10px] text-white/40">{title}</td>
      <td className="px-5 py-3 font-mono text-[10px] text-white/40">{reportsTo}</td>
      <td className="px-5 py-3">
        {status ? (
          <div className="flex items-center gap-1.5">
            <span className={`status-dot status-dot-${status}`} />
            <span className="font-mono text-[9px] text-white/40 uppercase">{status}</span>
          </div>
        ) : (
          <span className="font-mono text-[10px] text-white/20">—</span>
        )}
      </td>
      <td className="px-5 py-3 font-mono text-[9px] text-white/25">{lastActive}</td>
    </tr>
  );
}

function VerticalLine() {
  return <div className="h-8 w-px bg-gradient-to-b from-white/20 to-white/5" />;
}

function VerticalLineShort() {
  return <div className="h-5 w-px bg-gradient-to-b from-white/15 to-white/5" />;
}

function HorizontalBridge({ width }: { width: string }) {
  return (
    <div
      className="absolute top-0 left-1/2 h-px -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent"
      style={{ width }}
    />
  );
}
