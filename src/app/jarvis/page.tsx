"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Activity, Agent, Project, Task } from "@/lib/data";

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

function useClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return {
    time: now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    date: now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  };
}

function useJarvisData() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [
        agentsRes,
        tasksRes,
        projectsRes,
        activitiesRes,
        nodesRes,
        healthRes,
      ] = await Promise.all([
        fetch("/api/openclaw/agents").catch(() => null),
        fetch("/api/tasks").catch(() => null),
        fetch("/api/projects").catch(() => null),
        fetch("/api/activity?limit=12").catch(() => null),
        fetch("/api/openclaw/nodes").catch(() => null),
        fetch("/api/openclaw/health").catch(() => null),
      ]);

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
        setIsLive(data.source === "live");
      }

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        setTasks(Array.isArray(data) ? data : []);
      }

      if (projectsRes?.ok) {
        const data = await projectsRes.json();
        setProjects(Array.isArray(data) ? data : []);
      }

      if (activitiesRes?.ok) {
        const data = await activitiesRes.json();
        setActivities(Array.isArray(data) ? data : []);
      }

      if (nodesRes?.ok) {
        const data = await nodesRes.json();
        setNodes(data.nodes || []);
      }

      if (healthRes?.ok) {
        setHealth(await healthRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  return { agents, tasks, projects, activities, nodes, health, isLive, loading };
}

function formatRelativeTime(value?: string) {
  if (!value) return "Awaiting signal";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function statusTone(status: Agent["status"] | NodeInfo["status"]) {
  if (status === "online" || status === "connected") return "#63f5d2";
  if (status === "working") return "#ffd36b";
  if (status === "idle") return "#ff9c66";
  return "#7c8ba1";
}

export default function JarvisPage() {
  const { time, date } = useClock();
  const { agents, tasks, projects, activities, nodes, health, isLive, loading } = useJarvisData();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const orderedAgents = useMemo(() => {
    const statusOrder = { working: 0, online: 1, idle: 2, offline: 3 };
    return [...agents].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }, [agents]);

  useEffect(() => {
    if (!selectedAgentId && orderedAgents[0]) {
      setSelectedAgentId(orderedAgents[0].id);
    }
  }, [orderedAgents, selectedAgentId]);

  const selectedAgent = orderedAgents.find((agent) => agent.id === selectedAgentId) ?? orderedAgents[0] ?? null;
  const activeProjects = projects.filter((project) => project.status === "active");
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress");
  const reviewTasks = tasks.filter((task) => task.status === "review");
  const onlineCount = agents.filter((agent) => agent.status === "online" || agent.status === "working").length;
  const selectedAgentTasks = selectedAgent
    ? tasks.filter((task) => task.assignedAgentId === selectedAgent.id || task.assignedAgentId === selectedAgent.callsign.toLowerCase())
    : [];
  const selectedProjects = selectedAgent
    ? activeProjects.filter((project) => project.ownerAgentId === selectedAgent.id)
    : [];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020612] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(74,181,255,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(69,255,204,0.12),transparent_26%),linear-gradient(180deg,#030816_0%,#040b16_45%,#02050d_100%)]" />
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(90,132,173,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(90,132,173,0.13) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_58%,rgba(2,6,18,0.84)_100%)]" />

      <div className="relative z-10 flex min-h-screen flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="jarvis-panel mb-4 flex flex-col gap-4 rounded-[28px] px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-[#67f6d2] shadow-[0_0_20px_rgba(103,246,210,0.9)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.45em] text-[#8bc6ff]">Jarvis Mode</span>
              <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                {isLive ? "live uplink" : "standby"}
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Agent command surface</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#9cb0c9] sm:text-base">
              Full-screen cinematic view of crew status, task pressure, infrastructure pulse, and active operators.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <MetricPill label="Agents live" value={`${onlineCount}/${agents.length || 0}`} tone="#67f6d2" />
            <MetricPill label="Tasks running" value={String(inProgressTasks.length)} tone="#ffd36b" />
            <MetricPill label="In review" value={String(reviewTasks.length)} tone="#86a7ff" />
            <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/45">{date}</div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em] text-white">{time}</div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <section className="jarvis-panel rounded-[28px] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#7ea2c9]">Operators</p>
                <h2 className="mt-1 text-lg font-semibold text-white">Crew roster</h2>
              </div>
              <Link href="/team" className="jarvis-link">Team view</Link>
            </div>

            <div className="space-y-3">
              {orderedAgents.map((agent) => {
                const active = selectedAgent?.id === agent.id;
                const tone = statusTone(agent.status);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`jarvis-agent-card w-full text-left ${active ? "jarvis-agent-card-active" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-2xl shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
                        {agent.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-semibold uppercase tracking-[0.24em]" style={{ color: agent.color }}>
                            {agent.callsign}
                          </span>
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone, boxShadow: `0 0 16px ${tone}` }} />
                        </div>
                        <p className="mt-1 truncate text-sm text-white/80">{agent.title || agent.name}</p>
                        <p className="mt-2 truncate text-xs text-white/45">{agent.currentTask || "No active task"}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">
                      <span>{agent.status}</span>
                      <span>{formatRelativeTime(agent.lastActive)}</span>
                    </div>
                  </button>
                );
              })}

              {!loading && orderedAgents.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/12 bg-white/4 px-4 py-10 text-center text-sm text-white/55">
                  No live agents detected.
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex min-h-[620px] flex-col gap-4">
            <div className="jarvis-panel relative flex-1 overflow-hidden rounded-[32px] p-5 sm:p-6">
              <div className="absolute -left-24 top-10 h-52 w-52 rounded-full bg-[#4aa5ff]/10 blur-3xl" />
              <div className="absolute -right-16 bottom-0 h-48 w-48 rounded-full bg-[#45ffcc]/10 blur-3xl" />

              <div className="relative flex h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#7ea2c9]">Primary subject</p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                      {selectedAgent ? `${selectedAgent.emoji} ${selectedAgent.callsign}` : "No agent selected"}
                    </h2>
                    <p className="mt-2 max-w-xl text-sm text-[#a6b7cf]">
                      {selectedAgent?.currentTask || "Select an operator to inspect live task load, ownership, and system posture."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href="/chat" className="jarvis-action">Open chat</Link>
                    <Link href="/office" className="jarvis-action">Office view</Link>
                    <Link href="/dashboard" className="jarvis-action">Standard UI</Link>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
                  <div className="jarvis-core rounded-[28px] p-5 sm:p-6">
                    <div className="jarvis-reactor mx-auto">
                      <div className="jarvis-reactor-ring jarvis-reactor-ring-1" />
                      <div className="jarvis-reactor-ring jarvis-reactor-ring-2" />
                      <div className="jarvis-reactor-ring jarvis-reactor-ring-3" />
                      <div className="jarvis-reactor-grid" />
                      <div className="jarvis-reactor-core">
                        <div className="text-center">
                          <div className="text-5xl">{selectedAgent?.emoji || "🛰️"}</div>
                          <div className="mt-3 font-mono text-xs uppercase tracking-[0.38em] text-[#9fd0ff]">{selectedAgent?.status || "standby"}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      <SignalCard label="Task load" value={String(selectedAgentTasks.length)} help="Assigned items" />
                      <SignalCard label="Project ownership" value={String(selectedProjects.length)} help="Active projects" />
                      <SignalCard label="Last heartbeat" value={formatRelativeTime(selectedAgent?.lastActive)} help="Runtime signal" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="jarvis-subpanel rounded-[24px] p-4">
                      <PanelTitle eyebrow="Mission stack" title="Assigned work" />
                      <div className="mt-4 space-y-3">
                        {selectedAgentTasks.slice(0, 4).map((task) => (
                          <TaskRow key={task.id} task={task} />
                        ))}
                        {selectedAgentTasks.length === 0 ? (
                          <EmptyNote text="No tasks assigned to this operator." />
                        ) : null}
                      </div>
                    </div>

                    <div className="jarvis-subpanel rounded-[24px] p-4">
                      <PanelTitle eyebrow="Projects" title="Ownership surface" />
                      <div className="mt-4 space-y-3">
                        {selectedProjects.slice(0, 3).map((project) => (
                          <div key={project.id} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-medium text-white">{project.name}</span>
                              <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                                {project.status}
                              </span>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs text-white/45">{project.description || "No brief attached."}</p>
                          </div>
                        ))}
                        {selectedProjects.length === 0 ? (
                          <EmptyNote text="No active projects owned by this operator." />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <WideStat title="Projects active" value={String(activeProjects.length)} subtext="Open programs across the workspace" />
                  <WideStat title="Tasks in motion" value={String(inProgressTasks.length)} subtext="Live execution pressure" />
                  <WideStat title="Gateway" value={health?.source === "live" ? "online" : "offline"} subtext={health?.version ? `Version ${health.version}` : "Awaiting gateway telemetry"} />
                </div>
              </div>
            </div>

            <div className="jarvis-panel rounded-[28px] p-4 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                <div>
                  <PanelTitle eyebrow="Activity stream" title="Recent movement" />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {activities.slice(0, 6).map((activity) => (
                      <div key={activity.id} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#8bc6ff]">{activity.actionType.replaceAll("_", " ")}</span>
                          <span className="text-[11px] text-white/35">{formatRelativeTime(activity.createdAt)}</span>
                        </div>
                        <p className="mt-3 text-sm text-white/80">{activity.description}</p>
                      </div>
                    ))}
                    {!loading && activities.length === 0 ? <EmptyNote text="No recent activity." /> : null}
                  </div>
                </div>

                <div className="jarvis-subpanel rounded-[24px] p-4">
                  <PanelTitle eyebrow="Infrastructure" title="Node uplinks" />
                  <div className="mt-4 space-y-3">
                    {nodes.slice(0, 5).map((node) => (
                      <div key={node.id} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{node.name || node.id}</div>
                            <div className="mt-1 text-xs text-white/40">{node.hostname || "No hostname"}</div>
                          </div>
                          <span className="flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusTone(node.status), boxShadow: `0 0 16px ${statusTone(node.status)}` }} />
                            {node.status}
                          </span>
                        </div>
                        <div className="mt-3 text-[11px] uppercase tracking-[0.24em] text-white/35">
                          {node.connectedAt ? `linked ${formatRelativeTime(node.connectedAt)}` : node.lastSeen ? `seen ${formatRelativeTime(node.lastSeen)}` : "awaiting telemetry"}
                        </div>
                      </div>
                    ))}
                    {!loading && nodes.length === 0 ? <EmptyNote text="No nodes reporting in." /> : null}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="jarvis-panel rounded-[28px] p-4 sm:p-5">
              <PanelTitle eyebrow="Pressure" title="Queue pulse" />
              <div className="mt-4 space-y-3">
                <QueueRow label="Queued" value={tasks.filter((task) => task.status === "queued").length} tone="#67f6d2" />
                <QueueRow label="In progress" value={inProgressTasks.length} tone="#ffd36b" />
                <QueueRow label="Review" value={reviewTasks.length} tone="#86a7ff" />
                <QueueRow label="Done" value={tasks.filter((task) => task.status === "done").length} tone="#b38dff" />
              </div>
            </div>

            <div className="jarvis-panel rounded-[28px] p-4 sm:p-5">
              <PanelTitle eyebrow="Priority board" title="Highest urgency" />
              <div className="mt-4 space-y-3">
                {[...tasks]
                  .filter((task) => task.status !== "done")
                  .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
                  .slice(0, 5)
                  .map((task) => (
                    <TaskRow key={task.id} task={task} compact />
                  ))}
                {!loading && tasks.length === 0 ? <EmptyNote text="Task board is empty." /> : null}
              </div>
            </div>

            <div className="jarvis-panel rounded-[28px] p-4 sm:p-5">
              <PanelTitle eyebrow="System" title="Telemetry" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <TelemetryTile label="Gateway source" value={health?.source || "none"} />
                <TelemetryTile label="Gateway status" value={health?.status || "unknown"} />
                <TelemetryTile label="Version" value={health?.version || "n/a"} />
                <TelemetryTile label="Roster signal" value={isLive ? "connected" : "offline"} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/45">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-[-0.03em]" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function SignalCard({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/40">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-1 text-xs text-white/35">{help}</div>
    </div>
  );
}

function WideStat({ title, value, subtext }: { title: string; value: string; subtext: string }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/42">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-1 text-xs text-white/38">{subtext}</div>
    </div>
  );
}

function QueueRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-black/18 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">{label}</span>
        <span className="text-lg font-semibold" style={{ color: tone }}>{value}</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white/6">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(value * 12, 100)}%`, backgroundColor: tone, boxShadow: `0 0 20px ${tone}` }} />
      </div>
    </div>
  );
}

function TaskRow({ task, compact = false }: { task: Task; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/38">#{task.shortId} • {task.status.replaceAll("_", " ")}</div>
          <div className={`mt-1 ${compact ? "text-sm" : "text-[15px]"} font-medium text-white`}>{task.title}</div>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">{task.priority}</span>
      </div>
    </div>
  );
}

function TelemetryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/38">{label}</div>
      <div className="mt-2 text-lg font-medium text-white">{value}</div>
    </div>
  );
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#7ea2c9]">{eyebrow}</div>
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-white/45">{text}</div>;
}

function priorityRank(priority: Task["priority"]) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority];
}
