"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Agent, Task, Activity } from "@/lib/data";
import { ROLES } from "@/components/agent-config-fields";
import { timeAgo } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────

interface AgentSkillRow {
  skillId: string;
  skill: {
    name: string;
    slug: string;
    description?: string;
    metadata?: { icon?: string; category?: string; runtime?: string; command?: string | null };
  };
}

interface AgentDetail extends Agent {
  provider?: string;
  runtimeConfig?: Record<string, unknown>;
}

type Tab = "summary" | "skills" | "config" | "activity";

interface AgentProfilePanelProps {
  callsign: string;
  onClose: () => void;
  onEdit: (callsign: string) => void;
}

// ─── Status helpers ─────────────────────────────────────────────────────

const statusDotClass: Record<string, string> = {
  online: "bg-emerald-400",
  working: "bg-emerald-400 animate-pulse",
  active: "bg-emerald-400",
  running: "bg-emerald-400 animate-pulse",
  idle: "bg-amber-400",
  offline: "bg-[var(--text-tertiary)]/40",
};

const statusLabels: Record<string, string> = {
  online: "ONLINE",
  working: "WORKING",
  active: "ACTIVE",
  running: "RUNNING",
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
  openrouter: "OPENROUTER",
};

const priorityColors: Record<string, string> = {
  critical: "text-red-400 bg-red-400/10",
  high: "text-orange-400 bg-orange-400/10",
  medium: "text-amber-400 bg-amber-400/10",
  low: "text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)]",
};

const taskStatusLabels: Record<string, string> = {
  backlog: "BACKLOG",
  inbox: "INBOX",
  queued: "QUEUED",
  in_progress: "IN PROGRESS",
  review: "REVIEW",
  done: "DONE",
};

// ─── Skeleton ───────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-surface-hover)] ${className}`}
    />
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-4 p-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="mb-1.5 h-3 w-20" />
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
    </div>
  );
}

function SkillsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 flex-shrink-0 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Info Row ───────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)] mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function AgentProfilePanel({ callsign, onClose, onEdit }: AgentProfilePanelProps) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [skills, setSkills] = useState<AgentSkillRow[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [visible, setVisible] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Animate in on mount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Focus trap
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panel!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    // Focus the panel
    const firstButton = panel.querySelector<HTMLElement>("button");
    firstButton?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch agent details
  useEffect(() => {
    setLoadingAgent(true);
    fetch(`/api/agents/${callsign.toLowerCase()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setAgent(data);
      })
      .catch(() => {})
      .finally(() => setLoadingAgent(false));
  }, [callsign]);

  // Fetch skills
  useEffect(() => {
    setLoadingSkills(true);
    fetch(`/api/agents/${callsign.toLowerCase()}/skills`)
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows)) setSkills(rows.filter((r: AgentSkillRow) => r.skill));
      })
      .catch(() => {})
      .finally(() => setLoadingSkills(false));
  }, [callsign]);

  // Fetch tasks when activity tab is selected (or eagerly)
  useEffect(() => {
    if (!agent) return;
    setLoadingTasks(true);
    fetch(`/api/tasks?agentId=${agent.id}`)
      .then((r) => r.json())
      .then((data) => {
        const list = data.tasks ?? data;
        if (Array.isArray(list)) setTasks(list.slice(0, 10));
      })
      .catch(() => {})
      .finally(() => setLoadingTasks(false));
  }, [agent]);

  // Fetch activity
  useEffect(() => {
    if (!agent) return;
    setLoadingActivity(true);
    fetch(`/api/activity?agentId=${agent.id}&limit=15`)
      .then((r) => r.json())
      .then((data) => {
        const list = data.activities ?? data;
        if (Array.isArray(list)) setActivity(list.slice(0, 15));
      })
      .catch(() => {})
      .finally(() => setLoadingActivity(false));
  }, [agent]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  const agentColor = agent?.color ?? "#00f0ff";
  const roleLabel = ROLES.find((r) => r.value === agent?.role)?.label ?? agent?.role ?? "—";

  const runtimeConfig = (agent?.runtimeConfig ?? {}) as Record<string, unknown>;
  const heartbeat = (runtimeConfig.heartbeat ?? {}) as Record<string, unknown>;
  const adapterConfig = (agent?.adapterConfig ?? {}) as Record<string, unknown>;
  const envVars = (adapterConfig.envVars ?? {}) as Record<string, string>;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "summary", label: "Summary" },
    { key: "skills", label: "Skills", count: skills.length },
    { key: "config", label: "Config" },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-colors duration-250"
        style={{ backgroundColor: visible ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)" }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative flex h-full w-full flex-col bg-[var(--bg-primary)] shadow-2xl transition-transform duration-250 ease-out sm:w-[480px]"
        style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className="h-0.5 flex-shrink-0" style={{ backgroundColor: agentColor }} />

        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-[var(--border-subtle)] px-5 py-4">
          {loadingAgent ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ) : agent ? (
            <div className="flex items-start gap-3">
              {/* Emoji avatar */}
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl"
                style={{ backgroundColor: agentColor + "18" }}
              >
                {agent.emoji}
              </div>

              {/* Identity */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/agents/${agent.callsign.toLowerCase()}`}
                    className="font-mono text-sm font-bold tracking-wider transition-colors hover:underline"
                    style={{ color: agentColor }}
                  >
                    {agent.callsign.toUpperCase()}
                  </Link>
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${statusDotClass[agent.status] ?? statusDotClass.offline}`}
                  />
                  <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
                    {statusLabels[agent.status] ?? "OFFLINE"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {agent.name}
                </p>
              </div>

              {/* Close button */}
              <button
                onClick={handleClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
                aria-label="Close panel"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <p className="text-xs text-red-400">Agent not found</p>
          )}
        </div>

        {/* ─── Tabs ───────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 border-b border-[var(--border-subtle)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="relative flex items-center gap-1.5 px-4 py-2.5 text-[11px] tracking-wider transition-colors"
              style={{
                color: activeTab === tab.key ? agentColor : "var(--text-tertiary)",
              }}
            >
              {tab.label.toUpperCase()}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] leading-none"
                  style={{
                    backgroundColor: activeTab === tab.key ? agentColor + "20" : "var(--bg-surface-hover)",
                    color: activeTab === tab.key ? agentColor : "var(--text-tertiary)",
                  }}
                >
                  {tab.count}
                </span>
              )}
              {activeTab === tab.key && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-px"
                  style={{ backgroundColor: agentColor }}
                />
              )}
            </button>
          ))}
        </div>

        {/* ─── Tab Content ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "summary" && (
            <SummaryTab
              agent={agent}
              loading={loadingAgent}
              agentColor={agentColor}
              roleLabel={roleLabel}
              onEdit={onEdit}
            />
          )}
          {activeTab === "skills" && (
            <SkillsTab
              skills={skills}
              loading={loadingSkills}
              agentColor={agentColor}
              onEdit={agent ? () => onEdit(agent.callsign) : undefined}
            />
          )}
          {activeTab === "config" && (
            <ConfigTab
              agent={agent}
              loading={loadingAgent}
              heartbeat={heartbeat}
              adapterConfig={adapterConfig}
              envVars={envVars}
              onEdit={agent ? () => onEdit(agent.callsign) : undefined}
            />
          )}
          {activeTab === "activity" && (
            <ActivityTab
              tasks={tasks}
              activity={activity}
              loadingTasks={loadingTasks}
              loadingActivity={loadingActivity}
              agentColor={agentColor}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Tab ────────────────────────────────────────────────────────

function SummaryTab({
  agent,
  loading,
  agentColor,
  roleLabel,
  onEdit,
}: {
  agent: AgentDetail | null;
  loading: boolean;
  agentColor: string;
  roleLabel: string;
  onEdit: (callsign: string) => void;
}) {
  if (loading) return <SummarySkeleton />;
  if (!agent) return null;

  return (
    <div className="space-y-5 p-5">
      <dl className="space-y-4">
        {agent.title && (
          <InfoRow label="Title">{agent.title}</InfoRow>
        )}

        <InfoRow label="Role">{roleLabel}</InfoRow>

        {agent.reportsTo && (
          <InfoRow label="Reports To">
            <Link
              href={`/agents/${agent.reportsTo.toLowerCase()}`}
              className="font-mono text-xs tracking-wider transition-colors hover:underline"
              style={{ color: agentColor }}
            >
              {agent.reportsTo.toUpperCase()}
            </Link>
          </InfoRow>
        )}

        {agent.model && (
          <InfoRow label="Model">
            <span className="font-mono text-xs">{agent.model}</span>
          </InfoRow>
        )}

        {agent.provider && (
          <InfoRow label="Provider">
            <span className="capitalize">{agent.provider}</span>
          </InfoRow>
        )}

        <InfoRow label="Adapter">
          <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-secondary)]">
            {adapterLabels[agent.adapterType] || agent.adapterType?.toUpperCase()}
          </span>
        </InfoRow>

        {agent.workspacePath && (
          <InfoRow label="Workspace">
            <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
              {agent.workspacePath}
            </span>
          </InfoRow>
        )}

        <InfoRow label="Color">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-4 w-4 rounded border border-[var(--border-subtle)]"
              style={{ backgroundColor: agent.color }}
            />
            <span className="font-mono text-xs text-[var(--text-secondary)]">
              {agent.color}
            </span>
          </div>
        </InfoRow>

        <InfoRow label="Last Active">
          <span className="text-xs text-[var(--text-secondary)]">
            {agent.lastActive ? timeAgo(agent.lastActive) : "Never"}
          </span>
        </InfoRow>
      </dl>

      {/* Edit button */}
      <button
        onClick={() => onEdit(agent.callsign)}
        className="mt-2 w-full rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
      >
        EDIT AGENT
      </button>
    </div>
  );
}

// ─── Skills Tab ─────────────────────────────────────────────────────────

function SkillsTab({
  skills,
  loading,
  agentColor,
  onEdit,
}: {
  skills: AgentSkillRow[];
  loading: boolean;
  agentColor: string;
  onEdit?: () => void;
}) {
  if (loading) return <SkillsSkeleton />;

  return (
    <div className="p-5">
      {skills.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <span className="mb-2 text-2xl">⚡</span>
          <p className="text-xs text-[var(--text-tertiary)]">No skills assigned</p>
          {onEdit && (
            <button
              onClick={onEdit}
              className="mt-3 rounded-lg px-3 py-1.5 text-[10px] tracking-wider transition-colors"
              style={{ backgroundColor: agentColor + "18", color: agentColor }}
            >
              ASSIGN SKILLS
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {skills.map((s) => (
              <div
                key={s.skillId}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors hover:border-[var(--border-medium)]"
              >
                <span className="text-lg leading-none">
                  {s.skill.metadata?.icon ?? "⚡"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                    {s.skill.name}
                  </p>
                  {s.skill.metadata?.category && (
                    <p className="text-[10px] text-[var(--text-tertiary)]">
                      {s.skill.metadata.category}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {onEdit && (
            <button
              onClick={onEdit}
              className="mt-4 w-full rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            >
              MANAGE SKILLS
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Config Tab ─────────────────────────────────────────────────────────

function ConfigTab({
  agent,
  loading,
  heartbeat,
  adapterConfig,
  envVars,
  onEdit,
}: {
  agent: AgentDetail | null;
  loading: boolean;
  heartbeat: Record<string, unknown>;
  adapterConfig: Record<string, unknown>;
  envVars: Record<string, string>;
  onEdit?: () => void;
}) {
  if (loading) return <SummarySkeleton />;
  if (!agent) return null;

  const heartbeatEnabled = heartbeat.enabled as boolean | undefined;
  const intervalSec = heartbeat.intervalSec as number | undefined;
  const wakeOnDemand = heartbeat.wakeOnDemand as boolean | undefined;
  const cooldownSec = heartbeat.cooldownSec as number | undefined;
  const maxConcurrent = heartbeat.maxConcurrentRuns as number | undefined;
  const timeoutSec = adapterConfig.timeoutSec as number | undefined;
  const gracePeriodSec = adapterConfig.gracePeriodSec as number | undefined;

  const envKeys = Object.keys(envVars);

  return (
    <div className="space-y-5 p-5">
      {/* Heartbeat */}
      <div>
        <h3 className="mb-3 text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)]">
          Heartbeat
        </h3>
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Enabled</span>
            <span className={`text-xs font-medium ${heartbeatEnabled ? "text-emerald-400" : "text-[var(--text-tertiary)]"}`}>
              {heartbeatEnabled ? "Yes" : "No"}
            </span>
          </div>
          {heartbeatEnabled && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Interval</span>
                <span className="font-mono text-xs text-[var(--text-primary)]">{intervalSec ?? 300}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Wake on demand</span>
                <span className="text-xs text-[var(--text-primary)]">{wakeOnDemand ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Cooldown</span>
                <span className="font-mono text-xs text-[var(--text-primary)]">{cooldownSec ?? 60}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Max concurrent</span>
                <span className="font-mono text-xs text-[var(--text-primary)]">{maxConcurrent ?? 1}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Runtime */}
      <div>
        <h3 className="mb-3 text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)]">
          Runtime
        </h3>
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Timeout</span>
            <span className="font-mono text-xs text-[var(--text-primary)]">{timeoutSec ?? 600}s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Grace period</span>
            <span className="font-mono text-xs text-[var(--text-primary)]">{gracePeriodSec ?? 30}s</span>
          </div>
        </div>
      </div>

      {/* Env vars */}
      {envKeys.length > 0 && (
        <div>
          <h3 className="mb-3 text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)]">
            Environment Variables
          </h3>
          <div className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            {envKeys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-[var(--text-secondary)]">{key}</span>
                <span className="flex-shrink-0 font-mono text-xs text-[var(--text-tertiary)]">••••••••</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onEdit && (
        <button
          onClick={onEdit}
          className="mt-2 w-full rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-[11px] tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
        >
          EDIT CONFIGURATION
        </button>
      )}
    </div>
  );
}

// ─── Activity Tab ───────────────────────────────────────────────────────

function ActivityTab({
  tasks,
  activity,
  loadingTasks,
  loadingActivity,
  agentColor,
}: {
  tasks: Task[];
  activity: Activity[];
  loadingTasks: boolean;
  loadingActivity: boolean;
  agentColor: string;
}) {
  return (
    <div className="space-y-6 p-5">
      {/* Recent Tasks */}
      <div>
        <h3 className="mb-3 text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)]">
          Recent Tasks
        </h3>
        {loadingTasks ? (
          <ActivitySkeleton />
        ) : tasks.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">No tasks assigned</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors hover:border-[var(--border-medium)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                      #{task.shortId}
                    </span>
                    <span
                      className={`rounded px-1 py-0.5 text-[9px] tracking-wider ${priorityColors[task.priority] ?? priorityColors.low}`}
                    >
                      {task.priority.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--text-primary)]">
                    {task.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
                      {taskStatusLabels[task.status] ?? task.status.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {timeAgo(task.updatedAt)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <div>
        <h3 className="mb-3 text-[10px] tracking-[0.15em] uppercase text-[var(--text-tertiary)]">
          Activity
        </h3>
        {loadingActivity ? (
          <ActivitySkeleton />
        ) : activity.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">No activity recorded</p>
        ) : (
          <div className="space-y-2">
            {activity.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
              >
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[10px]"
                  style={{ backgroundColor: agentColor + "15", color: agentColor }}
                >
                  {activityIcon(item.actionType)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--text-primary)]">{item.description}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="rounded bg-[var(--bg-surface-hover)] px-1 py-0.5 text-[9px] tracking-wider text-[var(--text-tertiary)]">
                      {item.actionType.toUpperCase().replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {timeAgo(item.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function activityIcon(actionType: string): string {
  if (actionType.includes("task")) return "T";
  if (actionType.includes("commit") || actionType.includes("push")) return "G";
  if (actionType.includes("deploy")) return "D";
  if (actionType.includes("review")) return "R";
  if (actionType.includes("message") || actionType.includes("chat")) return "M";
  if (actionType.includes("start") || actionType.includes("run")) return "▶";
  if (actionType.includes("stop") || actionType.includes("exit")) return "■";
  return "•";
}
