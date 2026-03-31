"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Agent, Task, Activity } from "@/lib/data";
import { timeAgo } from "@/lib/utils";
import { AgentControlPanel, type AgentRuntimeStatus } from "@/components/agent-control-panel";
import { AgentOutputViewer } from "@/components/agent-output-viewer";
import { TaskDialog } from "@/components/task-dialog";

const glowTextClass: Record<string, string> = {
  "#00f0ff": "glow-text-neo",
  "#f0ff00": "glow-text-cipher",
  "#ff6600": "glow-text-havoc",
  "#00ff88": "glow-text-pulse",
  "#ff00aa": "glow-text-razor",
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
  claude_local: "Claude Code",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  openclaw_gateway: "OpenClaw Gateway",
  cursor: "Cursor",
  pi_local: "Pi",
  process: "Process",
  http: "HTTP",
};

type TabKey = "overview" | "terminal" | "tasks" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "OVERVIEW" },
  { key: "terminal", label: "TERMINAL" },
  { key: "tasks", label: "TASKS" },
  { key: "settings", label: "SETTINGS" },
];

/**
 * Full agent detail page with tabs for overview, terminal, tasks, and settings.
 * Displays agent identity, runtime control panel, and tabbed content sections.
 */
export default function AgentProfilePage() {
  const params = useParams<{ callsign: string }>();
  const callsign = params.callsign;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [agentTasks, setAgentTasks] = useState<Task[]>([]);
  const [agentActivities, setAgentActivities] = useState<Activity[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [agentRes, agentsRes, tasksRes, activityRes] = await Promise.all([
        fetch(`/api/agents/${callsign}`).catch(() => null),
        fetch("/api/openclaw/agents").catch(() => null),
        fetch("/api/tasks").catch(() => null),
        fetch("/api/activity").catch(() => null),
      ]);

      if (agentRes?.ok) {
        const data = await agentRes.json();
        setAgent(data);
      } else {
        setNotFound(true);
        return;
      }

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        setAllAgents(data.agents || []);
      }

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        const tasks = Array.isArray(data) ? data : [];
        setAgentTasks(tasks.filter((t: Task) => t.assignedAgentId === agent?.id));
      }

      if (activityRes?.ok) {
        const data = await activityRes.json();
        const activities = Array.isArray(data) ? data : [];
        setAgentActivities(activities.filter((a: Activity) => a.agentId === agent?.id));
      }
    } catch {
      /* empty */
    }
  }, [callsign, agent?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-[var(--text-tertiary)]">AGENT NOT FOUND</p>
          <Link
            href="/agents"
            className="mt-2 inline-block font-mono text-xs text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
          >
            &larr; BACK TO AGENTS
          </Link>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-5xl space-y-4 px-6">
          <div className="glass-card h-40 animate-pulse rounded-xl" />
          <div className="glass-card h-12 animate-pulse rounded-xl" />
          <div className="glass-card h-10 animate-pulse rounded-xl" />
          <div className="glass-card h-64 animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  const reportsTo = agent.reportsTo
    ? allAgents.find((a) => a.id === agent.reportsTo)
    : null;
  const directReports = allAgents.filter(
    (a) => a.reportsTo === agent.id
  );

  const runtimeLabel = runtimeStatus
    ? runtimeStatus.status === "running"
      ? "PROCESS RUNNING"
      : runtimeStatus.status === "starting"
        ? "STARTING UP"
        : runtimeStatus.status === "error"
          ? "PROCESS ERROR"
          : "PROCESS STOPPED"
    : null;

  return (
    <div className="min-h-screen">
      {/* Breadcrumb */}
      <nav className="border-b border-[var(--border-subtle)] px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
          >
            COMMAND CENTER
          </Link>
          <span className="text-xs text-[var(--text-tertiary)]">/</span>
          <Link
            href="/agents"
            className="text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
          >
            AGENTS
          </Link>
          <span className="text-xs text-[var(--text-tertiary)]">/</span>
          <span
            className="font-mono text-xs font-bold"
            style={{ color: agent.color }}
          >
            {agent.callsign.toUpperCase()}
          </span>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        {/* Hero section */}
        <div className="glass-card relative overflow-hidden p-6 sm:p-8">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `radial-gradient(ellipse at top left, ${agent.color}10, transparent 60%)`,
            }}
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-3xl sm:h-20 sm:w-20 sm:text-4xl"
              style={{
                boxShadow: `0 0 30px ${agent.color}20`,
              }}
            >
              {agent.emoji}
            </div>

            <div className="flex-1 min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h1
                  className={`font-mono text-xl font-bold tracking-wider sm:text-2xl ${glowTextClass[agent.color] ?? ""}`}
                  style={{ color: agent.color }}
                >
                  {agent.callsign.toUpperCase()}
                </h1>
                <div className="flex items-center gap-1.5">
                  <span className={`status-dot status-dot-${agent.status}`} />
                  <span className="font-mono text-[10px] tracking-wider text-[var(--text-secondary)]">
                    {statusLabels[agent.status]}
                  </span>
                </div>
                {/* Adapter badge */}
                <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)]">
                  {adapterLabels[agent.adapterType] || agent.adapterType.toUpperCase()}
                </span>
                {/* Runtime process badge */}
                {runtimeLabel && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] tracking-wider ${
                    runtimeStatus?.status === "running"
                      ? "bg-green-500/15 text-green-500"
                      : runtimeStatus?.status === "error"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                  }`}>
                    {runtimeLabel}
                  </span>
                )}
              </div>

              <p className="mb-3 text-sm text-[var(--text-secondary)]">{agent.title}</p>

              {agent.currentTask && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-[var(--bg-surface-hover)] px-3 py-1.5">
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    WORKING ON:
                  </span>
                  <span className="text-xs text-[var(--text-primary)]">
                    {agent.currentTask}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                  Last active: {timeAgo(agent.lastActive)}
                </span>
                {reportsTo && (
                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    Reports to:{" "}
                    <Link
                      href={`/agents/${reportsTo.callsign.toLowerCase()}`}
                      className="transition-colors hover:text-[var(--text-secondary)]"
                      style={{ color: reportsTo.color }}
                    >
                      {reportsTo.callsign}
                    </Link>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Control panel */}
        <AgentControlPanel
          callsign={callsign}
          onStatusChange={setRuntimeStatus}
        />

        {/* Quick actions bar */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowTaskDialog(true)}
            className="rounded-lg border border-[var(--accent)]/30 px-3 py-1.5 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            ASSIGN TASK
          </button>
          <button
            onClick={() => setActiveTab("terminal")}
            className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
          >
            VIEW LOGS
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
          >
            CONFIGURE
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-subtle)]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-[11px] tracking-wider transition-colors ${
                activeTab === tab.key
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {tab.label}
              {tab.key === "tasks" && agentTasks.length > 0 && (
                <span className="ml-1.5 text-[var(--text-tertiary)]">{agentTasks.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Agent config summary */}
            <div className="glass-card p-6">
              <h2 className="mb-4 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                Configuration
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">Adapter</span>
                  <p className="mt-0.5 text-sm text-[var(--text-primary)]">
                    {adapterLabels[agent.adapterType] || agent.adapterType}
                  </p>
                </div>
                {agent.model && (
                  <div>
                    <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">Model</span>
                    <p className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">{agent.model}</p>
                  </div>
                )}
                {agent.workspacePath && (
                  <div>
                    <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">Workspace</span>
                    <p className="mt-0.5 font-mono text-xs text-[var(--text-primary)] break-all">{agent.workspacePath}</p>
                  </div>
                )}
                <div>
                  <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">Role</span>
                  <p className="mt-0.5 text-sm text-[var(--text-primary)] capitalize">{agent.role}</p>
                </div>
              </div>
            </div>

            {/* Soul */}
            {agent.soulContent && (
              <div className="glass-card p-6">
                <h2 className="mb-3 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                  Soul
                </h2>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)] italic">
                  &ldquo;{agent.soulContent}&rdquo;
                </p>
              </div>
            )}

            {/* Direct reports */}
            {directReports.length > 0 && (
              <div className="glass-card p-6">
                <h2 className="mb-4 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                  Direct Reports
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {directReports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/agents/${report.callsign.toLowerCase()}`}
                      className="flex flex-col items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-all hover:bg-[var(--bg-surface-hover)]"
                    >
                      <span className="text-xl">{report.emoji}</span>
                      <span
                        className="font-mono text-[10px] font-bold tracking-wider"
                        style={{ color: report.color }}
                      >
                        {report.callsign.toUpperCase()}
                      </span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        {report.title}
                      </span>
                      <span className={`status-dot status-dot-${report.status} mt-1`} />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Two-column: recent tasks + activity */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="glass-card p-6">
                <h2 className="mb-4 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                  Recent Tasks ({agentTasks.length})
                </h2>
                {agentTasks.length > 0 ? (
                  <div className="space-y-2">
                    {agentTasks.slice(0, 5).map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                      >
                        <div className="flex items-start justify-between">
                          <p className="text-xs font-medium text-[var(--text-primary)]">
                            {task.title}
                          </p>
                          <span className={`priority-${task.priority} ml-2 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] uppercase`}>
                            {task.priority}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-tertiary)] uppercase">
                            {task.status.replace("_", " ")}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                            {timeAgo(task.updatedAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-xs text-[var(--text-tertiary)] py-4">
                    No tasks assigned
                  </p>
                )}
              </div>

              <div className="glass-card p-6">
                <h2 className="mb-4 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                  Recent Activity ({agentActivities.length})
                </h2>
                {agentActivities.length > 0 ? (
                  <div className="space-y-2">
                    {agentActivities.slice(0, 5).map((activity) => (
                      <div
                        key={activity.id}
                        className="relative rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                      >
                        <div
                          className="absolute left-0 top-0 h-full w-[3px] rounded-l"
                          style={{ backgroundColor: agent.color }}
                        />
                        <div className="ml-2">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-tertiary)] uppercase">
                              {activity.actionType}
                            </span>
                            <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                              {timeAgo(activity.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {activity.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-xs text-[var(--text-tertiary)] py-4">
                    No recent activity
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "terminal" && (
          <AgentOutputViewer callsign={callsign} maxHeight={600} />
        )}

        {activeTab === "tasks" && (
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                Task History ({agentTasks.length})
              </h2>
              <button
                onClick={() => setShowTaskDialog(true)}
                className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
              >
                + ASSIGN TASK
              </button>
            </div>
            {agentTasks.length > 0 ? (
              <div className="space-y-2">
                {agentTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {task.title}
                      </p>
                      <span className={`priority-${task.priority} ml-2 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] uppercase`}>
                        {task.priority}
                      </span>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-[11px] text-[var(--text-tertiary)] line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-tertiary)] uppercase">
                        {task.status.replace("_", " ")}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                        {timeAgo(task.updatedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-[var(--text-tertiary)] py-8">
                No tasks assigned to this agent yet.
              </p>
            )}
          </div>
        )}

        {activeTab === "settings" && (
          <div className="glass-card p-6">
            <h2 className="mb-4 text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
              Agent Configuration
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ConfigItem label="Name" value={agent.name} />
                <ConfigItem label="Callsign" value={agent.callsign.toUpperCase()} mono />
                <ConfigItem label="Adapter" value={adapterLabels[agent.adapterType] || agent.adapterType} />
                <ConfigItem label="Role" value={agent.role} />
                <ConfigItem label="Model" value={agent.model || "—"} mono />
                <ConfigItem label="Workspace" value={agent.workspacePath || "—"} mono />
                <ConfigItem label="Color" value={agent.color} mono />
                <ConfigItem label="Status" value={statusLabels[agent.status] || agent.status} />
              </div>

              {agent.soulContent && (
                <div>
                  <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">Soul Content</span>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] italic leading-relaxed">
                    {agent.soulContent}
                  </p>
                </div>
              )}

              <p className="text-[10px] text-[var(--text-tertiary)]">
                To edit this agent&apos;s configuration, use the agent management API or the edit form.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Task dialog */}
      {showTaskDialog && (
        <TaskDialog
          agent={agent}
          onClose={() => setShowTaskDialog(false)}
        />
      )}
    </div>
  );
}

/** Simple config display row */
function ConfigItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">{label}</span>
      <p className={`mt-0.5 text-sm text-[var(--text-primary)] ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}
