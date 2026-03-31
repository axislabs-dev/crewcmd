"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Agent, Task, Activity, Project } from "@/lib/data";
import { ActivityFeed } from "@/components/activity-feed";
import { timeAgo } from "@/lib/utils";

function useClock() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
      setDate(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return { time, date };
}

interface NodeInfo {
  id: string;
  name: string;
  hostname?: string;
  status: "connected" | "disconnected" | "unknown";
  connectedAt?: string;
  lastSeen?: string;
  capabilities?: string[];
}

interface HealthInfo {
  status: string;
  uptime?: number;
  version?: string;
  source: string;
}

function useLiveData() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [nodeAgentMap, setNodeAgentMap] = useState<Record<string, { emoji: string; callsign: string; color: string }[]>>({});
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [isLive, setIsLive] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [agentsRes, nodesRes, healthRes, tasksRes, projectsRes, activityRes, nodeConfigRes] = await Promise.all([
        fetch("/api/openclaw/agents").catch(() => null),
        fetch("/api/openclaw/nodes").catch(() => null),
        fetch("/api/openclaw/health").catch(() => null),
        fetch("/api/tasks").catch(() => null),
        fetch("/api/projects").catch(() => null),
        fetch("/api/activity?limit=15").catch(() => null),
        fetch("/api/config/nodes").catch(() => null),
      ]);

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        if (data.agents) {
          setAgents(data.agents);
          setIsLive(data.source === "live");
        }
      }

      if (nodesRes?.ok) {
        const data = await nodesRes.json();
        setNodes(data.nodes || []);
      }

      if (healthRes?.ok) {
        const data = await healthRes.json();
        setHealth(data);
      }

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        setTasks(Array.isArray(data) ? data : []);
      }

      if (projectsRes?.ok) {
        const data = await projectsRes.json();
        setProjects(Array.isArray(data) ? data : []);
      }

      if (activityRes?.ok) {
        const data = await activityRes.json();
        setActivities(Array.isArray(data) ? data : []);
      }

      if (nodeConfigRes?.ok) {
        const data = await nodeConfigRes.json();
        setNodeAgentMap(data);
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

  return { agents, tasks, projects, activities, nodes, nodeAgentMap, health, isLive };
}

export default function Dashboard() {
  const { time, date } = useClock();
  const { agents, tasks, projects, activities, nodes, nodeAgentMap, health, isLive } = useLiveData();

  const activeAgents = agents.filter(
    (a) => a.status === "online" || a.status === "working"
  );
  const tasksInProgress = tasks.filter((t) => t.status === "in_progress");
  const activeProjects = projects.filter((p) => p.status === "active");

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="glow-text-neo font-mono text-lg font-bold tracking-[0.15em] text-[var(--accent)] sm:text-xl">
              COMMAND CENTER
            </h1>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs tracking-wider text-[var(--text-secondary)]">
                TACTICAL OVERVIEW
              </p>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${isLive ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" : "bg-[var(--text-tertiary)]"}`}
                title={isLive ? "LIVE — OpenClaw Connected" : "OFFLINE — No Data Source"}
              />
              <span className="font-mono text-[11px] tracking-wider text-[var(--text-tertiary)]">
                {isLive ? "LIVE" : "OFFLINE"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {time}
              </span>
              <span className="font-mono text-xs text-[var(--text-secondary)]">{date}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="AGENTS ONLINE"
            value={agents.length > 0 ? `${activeAgents.length}/${agents.length}` : "—"}
            color="#00f0ff"
          />
          <StatCard
            label="IN PROGRESS"
            value={String(tasksInProgress.length)}
            color="#f0ff00"
          />
          <StatCard
            label="ACTIVE PROJECTS"
            value={String(activeProjects.length)}
            color="#00ff88"
          />
          <StatCard
            label="RECENT ACTIVITY"
            value={String(activities.length)}
            color="#ff00aa"
          />
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-sm tracking-[0.15em] text-[var(--text-secondary)] uppercase">
              Agent Status
            </h2>
            <Link
              href="/agents"
              className="font-mono text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
            >
              VIEW ALL &rarr;
            </Link>
          </div>
          {agents.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8">
              {[...agents]
                .sort((a, b) => {
                  const order = { working: 0, online: 1, idle: 2, offline: 3 };
                  return order[a.status] - order[b.status];
                })
                .map((agent) => (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.callsign.toLowerCase()}`}
                    className="glass-card glass-card-hover flex items-center gap-2.5 p-3 transition-all duration-200"
                    style={{ borderColor: `${agent.color}10` }}
                  >
                    <span className="text-lg">{agent.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate font-mono text-[11px] font-bold tracking-wider"
                          style={{ color: agent.color }}
                        >
                          {agent.callsign.toUpperCase()}
                        </span>
                        <span className={`status-dot status-dot-${agent.status} shrink-0`} />
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-secondary)]">
                        {agent.currentTask ?? "No active task"}
                      </p>
                    </div>
                  </Link>
                ))}
            </div>
          ) : (
            <div className="glass-card flex items-center justify-center py-8">
              <p className="text-sm text-[var(--text-tertiary)]">
                No agents detected — connect OpenClaw to see your team
              </p>
            </div>
          )}
        </section>

        {(nodes.length > 0 || health) && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-sm tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                Infrastructure
              </h2>
              {health && (
                <span className="font-mono text-[11px] tracking-wider text-[var(--text-tertiary)]">
                  GATEWAY{" "}
                  <span
                    className={
                      health.source === "live"
                        ? "text-green-400"
                        : "text-red-400"
                    }
                  >
                    {health.source === "live" ? "ONLINE" : "OFFLINE"}
                  </span>
                  {health.version && (
                    <span className="ml-2 text-[var(--text-tertiary)]">v{health.version}</span>
                  )}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nodes.map((node) => (
                <NodeCard key={node.id} node={node} nodeAgentMap={nodeAgentMap} />
              ))}
              {nodes.length === 0 && health && (
                <div className="glass-card col-span-full flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-surface-hover)]">
                    <span className="text-lg">🖥️</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--text-secondary)]">
                      NO NODES DETECTED
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      Node connections will appear here when available
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-sm tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                Active Projects
              </h2>
              <Link
                href="/projects"
                className="font-mono text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
              >
                VIEW ALL &rarr;
              </Link>
            </div>
            {activeProjects.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeProjects.map((project) => {
                  const projectTasks = tasks.filter(
                    (t) => t.projectId === project.id
                  );
                  const doneTasks = projectTasks.filter(
                    (t) => t.status === "done"
                  );
                  const pct =
                    projectTasks.length > 0
                      ? Math.round((doneTasks.length / projectTasks.length) * 100)
                      : 0;
                  const owner = agents.find(
                    (a) => a.id === project.ownerAgentId
                  );

                  return (
                    <Link
                      key={project.id}
                      href={`/projects?id=${project.id}`}
                      className="glass-card glass-card-hover group p-4 transition-all duration-200"
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <h3 className="font-mono text-sm font-bold text-[var(--text-primary)]">
                          {project.name}
                        </h3>
                        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent)] uppercase">
                          {project.status}
                        </span>
                      </div>
                      <p className="mb-3 text-xs text-[var(--text-secondary)] line-clamp-2">
                        {project.description}
                      </p>
                      <div className="mb-2 h-1 overflow-hidden rounded-full bg-[var(--bg-surface-hover)]">
                        <div
                          className="h-full rounded-full bg-neo/60 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          {doneTasks.length}/{projectTasks.length} tasks &middot;{" "}
                          {pct}%
                        </span>
                        {owner && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs">{owner.emoji}</span>
                            <span
                              className="font-mono text-[9px]"
                              style={{ color: owner.color }}
                            >
                              {owner.callsign}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="glass-card flex items-center justify-center py-8">
                <p className="text-sm text-[var(--text-tertiary)]">
                  No projects created yet
                </p>
              </div>
            )}
          </section>

          <div className="glass-card max-h-[500px] overflow-hidden p-4">
            <ActivityFeed
              activities={activities.slice(0, 15)}
              agents={agents}
            />
          </div>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-sm tracking-[0.15em] text-[var(--text-secondary)] uppercase">
              Tasks In Progress
            </h2>
            <Link
              href="/tasks"
              className="font-mono text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
            >
              VIEW BOARD &rarr;
            </Link>
          </div>
          {tasksInProgress.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tasksInProgress.map((task) => {
                const agent = task.assignedAgentId
                  ? agents.find((a) => a.id === task.assignedAgentId)
                  : null;
                return (
                  <div
                    key={task.id}
                    className="glass-card flex items-start gap-3 p-3"
                  >
                    <span
                      className={`priority-${task.priority} mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase`}
                    >
                      {task.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {task.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        {agent && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs">{agent.emoji}</span>
                            <span
                              className="font-mono text-[9px]"
                              style={{ color: agent.color }}
                            >
                              {agent.callsign}
                            </span>
                          </div>
                        )}
                        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          {timeAgo(task.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass-card flex items-center justify-center py-8">
              <p className="text-sm text-[var(--text-tertiary)]">
                No tasks in progress
              </p>
            </div>
          )}
        </section>

        <section className="glass-card p-6">
          <h2 className="mb-4 font-mono text-sm tracking-[0.15em] text-[var(--text-secondary)] uppercase">
            Quick Stats
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ChartPlaceholder label="Tasks by Status" />
            <ChartPlaceholder label="Agent Activity (7d)" />
            <ChartPlaceholder label="Project Progress" />
            <ChartPlaceholder label="Task Velocity" />
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--border-subtle)] px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-wider text-[var(--text-tertiary)]">
            CREWCMD v0.2.0
          </span>
          <span className="font-mono text-[11px] tracking-wider text-[var(--text-tertiary)]">
            crewcmd.dev
          </span>
        </div>
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="glass-card relative overflow-hidden p-4"
      style={{ borderColor: `${color}15` }}
    >
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(ellipse at top right, ${color}08, transparent 70%)`,
        }}
      />
      <div className="relative">
        <span className="font-mono text-[11px] tracking-widest text-[var(--text-secondary)] uppercase">
          {label}
        </span>
        <p className="mt-1 font-mono text-2xl font-bold" style={{ color }}>
          {value}
        </p>
      </div>
    </div>
  );
}

function NodeCard({ node, nodeAgentMap }: { node: NodeInfo; nodeAgentMap: Record<string, { emoji: string; callsign: string; color: string }[]> }) {
  const isConnected = node.status === "connected";
  const statusColor = isConnected ? "#00ff88" : "#555555";
  const nodeAgents = nodeAgentMap[node.name] || [];
  const uptimeText = node.connectedAt
    ? timeAgo(node.connectedAt)
    : node.lastSeen
      ? `Last seen ${timeAgo(node.lastSeen)}`
      : "Unknown";

  return (
    <div
      className="glass-card flex items-center gap-4 p-4 transition-all duration-200"
      style={{ borderColor: `${statusColor}15` }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: `${statusColor}10` }}
      >
        <span className="text-lg">🖥️</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
            {node.name || node.id}
          </span>
          <span className={`status-dot ${isConnected ? "status-dot-online" : "status-dot-offline"}`} />
        </div>
        {node.hostname && (
          <p className="text-xs text-[var(--text-secondary)]">{node.hostname}</p>
        )}
        <div className="mt-1 flex items-center gap-3">
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {isConnected ? "CONNECTED" : "DISCONNECTED"}
          </span>
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {uptimeText}
          </span>
        </div>
        {node.capabilities && node.capabilities.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.capabilities.slice(0, 4).map((cap) => (
              <span
                key={cap}
                className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]"
              >
                {cap}
              </span>
            ))}
          </div>
        )}
        {nodeAgents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {nodeAgents.map((a) => (
              <span
                key={a.callsign}
                className="rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider"
                style={{
                  color: a.color,
                  borderColor: `${a.color}30`,
                  backgroundColor: `${a.color}08`,
                }}
              >
                {a.emoji} {a.callsign.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-medium)] py-8">
      <svg
        className="mb-2 h-8 w-8 text-[var(--text-tertiary)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
        />
      </svg>
      <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}
