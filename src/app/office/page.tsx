"use client";

import { useEffect, useState, useCallback } from "react";
import "./office.css";

interface Agent {
  id: string;
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  color: string;
  status: string;
  currentTask: string | null;
  lastActive: string;
}

interface TaskStats {
  done: number;
  total: number;
  clearance: number;
}

const AGENT_META: Record<string, { emoji: string; color: string }> = {
  neo: { emoji: "🕶️", color: "#00f0ff" },
  cipher: { emoji: "⚡", color: "#f0ff00" },
  forge: { emoji: "🔨", color: "#aaaaff" },
  blitz: { emoji: "⚡", color: "#ffdd00" },
  sentinel: { emoji: "🛡️", color: "#ff8800" },
  maverick: { emoji: "🎰", color: "#ff4444" },
  axiom: { emoji: "🧬", color: "#00ddff" },
  havoc: { emoji: "🔥", color: "#ff6600" },
  razor: { emoji: "✂️", color: "#ff00aa" },
  ghost: { emoji: "👻", color: "#aa88ff" },
  pulse: { emoji: "📡", color: "#00ff88" },
  viper: { emoji: "🐍", color: "#88ff00" },
};

const STATUS_MESSAGES: Record<string, string[]> = {
  online: [
    "Pushing commits",
    "Running models",
    "Reviewing pipeline",
    "Shipping MVPs",
    "Scanning logs",
    "Deploying hotfix",
  ],
  working: [
    "In the zone...",
    "On a deadline",
    "Do not disturb",
    "Deep work mode",
    "Locked in",
  ],
  idle: [
    "Grabbing coffee",
    "Stretching",
    "Deep in thought",
    "Refilling water",
    "Quick break",
  ],
  offline: ["Out of office", "Gone dark", "Signed off", "AFK"],
};

function getStatusMessage(status: string, callsign: string): string {
  const msgs = STATUS_MESSAGES[status] || STATUS_MESSAGES.offline;
  const seed = callsign.charCodeAt(0) + callsign.length;
  return msgs[seed % msgs.length];
}

const MATRIX_CHARS = "01アイウエオカキクケコ";

function MatrixRain() {
  const cols = 8;
  return (
    <div className="matrix-rain">
      {Array.from({ length: cols }).map((_, i) => (
        <span
          key={i}
          className="matrix-col"
          style={{
            left: `${(i / cols) * 100}%`,
            animationDuration: `${2 + (i % 3)}s`,
            animationDelay: `${(i * 0.4) % 2}s`,
          }}
        >
          {Array.from({ length: 12 })
            .map(() => MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)])
            .join("\n")}
        </span>
      ))}
    </div>
  );
}

function OfficeRoom({ callsign, status, color }: { callsign: string; status: string; color: string }) {
  const cs = callsign.toLowerCase();

  const renderRoomProps = () => {
    switch (cs) {
      case "neo":
        return (
          <>
            <div className="window" />
            <div className="neon-sign">CREWCMD</div>
            <div className="desk" />
          </>
        );
      case "cipher":
        return (
          <>
            <MatrixRain />
            <div className="monitors">
              <div className="mon" />
              <div className="mon" />
              <div className="mon" />
              <div className="mon" />
            </div>
            <div className="desk" />
          </>
        );
      case "forge":
        return (
          <>
            <div className="tool-rack" />
            <div className="desk" />
          </>
        );
      case "blitz":
        return (
          <>
            <div className="sticky" />
            <div className="sticky" />
            <div className="sticky" />
            <div className="sticky" />
            <div className="can" style={{ left: "20%" }} />
            <div className="can" style={{ left: "75%" }} />
            <div className="desk" />
          </>
        );
      case "sentinel":
        return (
          <>
            <div className="cctv-panel">
              <div className="cctv-screen" />
              <div className="cctv-screen" />
              <div className="cctv-screen" />
              <div className="cctv-screen" />
            </div>
            <div className="desk" />
          </>
        );
      case "maverick":
        return (
          <>
            <div className="ticker-bar">
              <div className="ticker-tape">
                <span className="up">AAPL +2.4%</span>
                <span className="down">TSLA -1.2%</span>
                <span className="up">NVDA +5.1%</span>
                <span className="down">META -0.8%</span>
                <span className="up">BTC +3.7%</span>
              </div>
            </div>
            <div className="desk" />
          </>
        );
      case "axiom":
        return (
          <>
            <div className="whiteboard" />
            <div className="desk" />
          </>
        );
      case "havoc":
        return (
          <>
            <div className="mood-board">
              <span style={{ background: "#f60" }} />
              <span style={{ background: "#fa0" }} />
              <span style={{ background: "#f30" }} />
              <span style={{ background: "#ff0" }} />
              <span style={{ background: "#f80" }} />
              <span style={{ background: "#e40" }} />
            </div>
            <div className="plant" style={{ left: "78%" }} />
            <div className="plant" style={{ left: "88%" }} />
            <div className="desk" />
          </>
        );
      case "razor":
        return (
          <>
            <div className="camera-rig" />
            <div className="softbox" style={{ left: "10%" }} />
            <div className="softbox" style={{ right: "10%" }} />
            <div className="desk" />
          </>
        );
      case "ghost":
        return (
          <>
            <div className="keyword-cloud">
              <span style={{ top: "2px", left: "4px" }}>SEO</span>
              <span style={{ top: "12px", left: "24px", fontSize: "7px" }}>RANK</span>
              <span style={{ top: "4px", left: "50px" }}>CTR</span>
              <span style={{ top: "16px", left: "8px", fontSize: "4px" }}>backlinks</span>
              <span style={{ top: "8px", left: "68px", fontSize: "6px" }}>SERP</span>
            </div>
            <div className="desk" />
          </>
        );
      case "pulse":
        return (
          <>
            <div className="social-feed" />
            <div className="desk" />
          </>
        );
      case "viper":
        return (
          <>
            <div className="deal-board" />
            <div className="phone" />
            <div className="desk" />
          </>
        );
      default:
        return <div className="desk" />;
    }
  };

  return (
    <div className={`office-room room-${cs} status-${status}`}>
      <div className="floor" />
      {renderRoomProps()}
      {status === "working" && (
        <div className="progress-overhead">
          <div className="bar" style={{ background: color }} />
        </div>
      )}
      <div className={`pixel-char char-${cs}`} />
      {status === "offline" && (
        <div className="out-sign" style={{ display: "block" }}>OUT</div>
      )}
    </div>
  );
}

function StatusBadge({ status, color }: { status: string; color: string }) {
  const bgAlpha = status === "offline" ? "0.15" : "0.15";
  const dotClass = `status-dot status-dot-${status}`;

  return (
    <span
      className="status-badge"
      style={{
        background: `rgba(${hexToRgb(color)}, ${bgAlpha})`,
        border: `1px solid rgba(${hexToRgb(color)}, 0.3)`,
        color,
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      <span className={dotClass} style={{ width: 5, height: 5 }} />
      {status}
    </span>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function StatsPanel({
  stats,
  color,
  isTopPerformer,
}: {
  stats: TaskStats;
  color: string;
  isTopPerformer: boolean;
}) {
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-value" style={{ color }}>
          {stats.done}
        </span>
        done
      </div>
      <div className="stat-item">
        <div className="clearance-bar">
          <div
            className="clearance-fill"
            style={{
              width: `${stats.clearance}%`,
              background: color,
            }}
          />
        </div>
        <span className="stat-value" style={{ color }}>
          {stats.clearance}%
        </span>
      </div>
      {isTopPerformer && <span className="gold-star" title="Top Performer">🏆</span>}
    </div>
  );
}

export default function OfficePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [taskStats, setTaskStats] = useState<Record<string, TaskStats>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const agentsRes = await fetch("/api/openclaw/agents").catch(() => null);
      let agentList: Agent[] = [];
      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        agentList = data.agents || data || [];
      }

      if (agentList.length === 0) {
        // Fallback: show all known agents as offline
        agentList = Object.entries(AGENT_META).map(([callsign, meta]) => ({
          id: callsign,
          callsign: callsign.charAt(0).toUpperCase() + callsign.slice(1),
          name: callsign.charAt(0).toUpperCase() + callsign.slice(1),
          title: "",
          emoji: meta.emoji,
          color: meta.color,
          status: "offline",
          currentTask: null,
          lastActive: new Date().toISOString(),
        }));
      }

      // Fetch task stats per agent
      const statsMap: Record<string, TaskStats> = {};
      await Promise.all(
        agentList.map(async (agent) => {
          try {
            const res = await fetch(`/api/tasks?agentId=${agent.callsign?.toLowerCase() || agent.id}`);
            if (res.ok) {
              const data = await res.json();
              const tasks = data.tasks || data || [];
              const done = tasks.filter((t: { status: string }) => t.status === "done").length;
              const total = tasks.length;
              statsMap[agent.callsign?.toLowerCase() || agent.id] = {
                done,
                total,
                clearance: total > 0 ? Math.round((done / total) * 100) : 0,
              };
            }
          } catch {
            // skip
          }
        })
      );

      setAgents(agentList);
      setTaskStats(statsMap);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Find top performer
  const topPerformer = Object.entries(taskStats).reduce<string | null>(
    (best, [callsign, stats]) => {
      if (!best) return callsign;
      const bestStats = taskStats[best];
      if (stats.done > (bestStats?.done || 0)) return callsign;
      return best;
    },
    null
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center lg:pl-[220px]">
        <div className="font-mono text-sm text-white/30 animate-pulse">
          Loading office floor...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-14 lg:pt-0 lg:pl-[220px]">
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-mono text-lg font-bold tracking-wider text-white/90">
            🏢 THE OFFICE
          </h1>
          <p className="font-mono text-xs text-white/30 mt-1">
            CREWCMD HQ — LIVE AGENT FLOOR
          </p>
        </div>

        {/* Office Grid */}
        <div className="office-grid">
          {agents.map((agent) => {
            const cs = agent.callsign?.toLowerCase() || agent.id;
            const meta = AGENT_META[cs] || { emoji: "🤖", color: "#888" };
            const color = meta.color;
            const status = agent.status || "offline";
            const stats = taskStats[cs] || { done: 0, total: 0, clearance: 0 };

            return (
              <div
                key={cs}
                className="office-zone animate-fade-in"
                style={{
                  animationDelay: `${Object.keys(AGENT_META).indexOf(cs) * 0.05}s`,
                  animationFillMode: "both",
                }}
              >
                <OfficeRoom callsign={cs} status={status} color={color} />

                <div className="office-info">
                  <div className="agent-header">
                    <span>{meta.emoji}</span>
                    <span className="agent-name" style={{ color }}>
                      {agent.callsign || cs.toUpperCase()}
                    </span>
                    <StatusBadge status={status} color={color} />
                  </div>
                  <div className="status-msg">
                    {agent.currentTask || getStatusMessage(status, cs)}
                  </div>
                  <StatsPanel
                    stats={stats}
                    color={color}
                    isTopPerformer={topPerformer === cs}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
