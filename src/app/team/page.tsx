"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { NewAgentDialog } from "@/components/new-agent-dialog";
import { EditAgentDialog } from "@/components/edit-agent-dialog";
import { AgentProfilePanel } from "@/components/agent-profile-panel";
import { TaskDialog } from "@/components/task-dialog";
import { AgentRuntimeBadge } from "@/components/agent-runtime-badge";
import type { Agent } from "@/lib/data";

const TeamCanvas = lazy(() =>
  import("@/components/team-canvas/team-canvas").then((m) => ({ default: m.TeamCanvas }))
);

// ─── Types ──────────────────────────────────────────────────────────────

interface AgentSkillBadge {
  slug: string;
  name: string;
  icon: string;
}

interface TreeNode {
  agent: Agent;
  children: TreeNode[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getCompanyId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_company=([^;]*)/);
  return match ? match[1] : null;
}

function buildTree(agents: Agent[]): TreeNode[] {
  const byCallsign = new Map<string, Agent>();
  for (const a of agents) byCallsign.set(a.callsign.toLowerCase(), a);

  const childrenOf = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const parent = a.reportsTo?.toLowerCase() ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(a);
  }

  function build(parentCallsign: string): TreeNode[] {
    const kids = childrenOf.get(parentCallsign) ?? [];
    return kids
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({
        agent,
        children: build(agent.callsign.toLowerCase()),
      }));
  }

  const roots: Agent[] = [];
  const orphans: Agent[] = [];
  for (const a of agents) {
    if (!a.reportsTo) {
      roots.push(a);
    } else if (!byCallsign.has(a.reportsTo.toLowerCase())) {
      orphans.push(a);
    }
  }

  const tree = roots
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agent) => ({
      agent,
      children: build(agent.callsign.toLowerCase()),
    }));

  for (const a of orphans) {
    tree.push({ agent: a, children: build(a.callsign.toLowerCase()) });
  }

  return tree;
}

function countNodes(nodes: TreeNode[]): number {
  let c = 0;
  for (const n of nodes) {
    c += 1 + countNodes(n.children);
  }
  return c;
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

// ─── View modes ─────────────────────────────────────────────────────────

type ViewMode = "canvas" | "tree" | "grid";

// ─── Tree Node Card ─────────────────────────────────────────────────────

function NodeCard({
  node,
  depth,
  skills,
  onEdit,
  onAddChild,
  onAssignTask,
  onRefresh,
  collapsed,
  onToggleCollapse,
  onCardClick,
}: {
  node: TreeNode;
  depth: number;
  skills: Record<string, AgentSkillBadge[]>;
  onEdit: (callsign: string) => void;
  onAddChild: (parentCallsign: string) => void;
  onAssignTask: (agent: Agent) => void;
  onRefresh: () => void;
  collapsed: Set<string>;
  onToggleCollapse: (callsign: string) => void;
  onCardClick: (callsign: string) => void;
}) {
  const { agent } = node;
  const reportCount = countNodes(node.children);
  const isCollapsed = collapsed.has(agent.callsign);
  const agentSkills = skills[agent.id] ?? [];

  return (
    <div className={depth > 0 ? "ml-6 sm:ml-10 border-l border-[var(--border-subtle)] pl-3 sm:pl-5" : ""}>
      <div
        className="group relative flex cursor-pointer items-stretch gap-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-all hover:border-[var(--accent-medium)] hover:shadow-lg hover:shadow-[var(--accent)]/5"
        onClick={() => onCardClick(agent.callsign)}
      >
        {/* Color accent bar */}
        <div
          className="w-1 rounded-l-xl flex-shrink-0"
          style={{ backgroundColor: agent.color }}
        />

        {/* Main content */}
        <div className="flex flex-1 items-center gap-3 p-3 min-w-0">
          {/* Collapse toggle for nodes with children */}
          {node.children.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(agent.callsign); }}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
            >
              <svg
                className={`h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="w-5 flex-shrink-0" />
          )}

          {/* Avatar */}
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-lg"
            style={{ backgroundColor: agent.color + "18" }}
          >
            {agent.emoji}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/agents/${agent.callsign.toLowerCase()}`}
                className="font-mono text-xs font-bold tracking-wider transition-colors hover:underline"
                style={{ color: agent.color }}
                onClick={(e) => e.stopPropagation()}
              >
                {agent.callsign.toUpperCase()}
              </Link>
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {agent.name}
              </span>
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusDotClass[agent.status] ?? statusDotClass.offline}`} />
              <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] hidden sm:inline">
                {statusLabels[agent.status] ?? "OFFLINE"}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-[var(--text-tertiary)]">{agent.title}</span>
              <span className="rounded bg-[var(--bg-surface-hover)] px-1 py-0.5 text-[9px] tracking-wider text-[var(--text-tertiary)]">
                {adapterLabels[agent.adapterType] || agent.adapterType?.toUpperCase()}
              </span>
              {agent.model && (
                <span className="rounded bg-[var(--bg-surface-hover)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-tertiary)] hidden sm:inline">
                  {agent.model}
                </span>
              )}
            </div>
            {/* Skills */}
            {agentSkills.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {agentSkills.slice(0, 5).map((s) => (
                  <span
                    key={s.slug}
                    className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[8px] tracking-wider text-[var(--accent)]"
                    title={s.name}
                  >
                    <span className="text-[9px] leading-none">{s.icon}</span>
                    {s.name}
                  </span>
                ))}
                {agentSkills.length > 5 && (
                  <span className="text-[8px] text-[var(--text-tertiary)]">
                    +{agentSkills.length - 5}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Report count badge */}
          {reportCount > 0 && (
            <span className="hidden sm:flex items-center gap-1 rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
              {reportCount}
            </span>
          )}

          {/* Runtime badge */}
          <div className="hidden sm:block flex-shrink-0">
            <AgentRuntimeBadge callsign={agent.callsign.toLowerCase()} onStartStop={onRefresh} />
          </div>

          {/* Action buttons (visible on hover) */}
          <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onAssignTask(agent)}
              className="rounded-md bg-[var(--bg-surface-hover)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              title="Assign task"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              onClick={() => onAddChild(agent.callsign)}
              className="rounded-md bg-[var(--bg-surface-hover)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              title="Add direct report"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
              </svg>
            </button>
            <button
              onClick={() => onEdit(agent.callsign)}
              className="rounded-md bg-[var(--bg-surface-hover)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              title="Edit agent"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Children */}
      {!isCollapsed && node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <NodeCard
              key={child.agent.id}
              node={child}
              depth={depth + 1}
              skills={skills}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onAssignTask={onAssignTask}
              onRefresh={onRefresh}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onCardClick={onCardClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Grid Card ──────────────────────────────────────────────────────────

function GridCard({
  agent,
  skills,
  onEdit,
  onAssignTask,
  onRefresh,
  onCardClick,
}: {
  agent: Agent;
  skills: AgentSkillBadge[];
  onEdit: (callsign: string) => void;
  onAssignTask: (agent: Agent) => void;
  onRefresh: () => void;
  onCardClick: (callsign: string) => void;
}) {
  return (
    <div className="glass-card glass-card-hover group relative cursor-pointer overflow-hidden p-4 transition-all duration-300" onClick={() => onCardClick(agent.callsign)}>
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at top, ${agent.color}08, transparent 70%)` }}
      />
      <div className="relative">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{agent.emoji}</span>
            <div>
              <Link
                href={`/agents/${agent.callsign.toLowerCase()}`}
                className="font-mono text-sm font-bold tracking-wider transition-colors hover:underline"
                style={{ color: agent.color }}
                onClick={(e) => e.stopPropagation()}
              >
                {agent.callsign.toUpperCase()}
              </Link>
              <p className="text-xs text-[var(--text-tertiary)]">{agent.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[agent.status] ?? statusDotClass.offline}`} />
            <span className="text-[10px] tracking-wider text-[var(--text-secondary)]">
              {statusLabels[agent.status] ?? "OFFLINE"}
            </span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)]">
            {adapterLabels[agent.adapterType] || agent.adapterType?.toUpperCase()}
          </span>
          {agent.role && (
            <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)]">
              {agent.role.toUpperCase()}
            </span>
          )}
        </div>

        {skills.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {skills.slice(0, 4).map((s) => (
              <span
                key={s.slug}
                className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--accent)]"
              >
                <span className="text-[10px] leading-none">{s.icon}</span>
                {s.name}
              </span>
            ))}
          </div>
        )}

        {agent.currentTask && (
          <div className="mb-3 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
            <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">CURRENT TASK</span>
            <p className="mt-0.5 text-xs text-[var(--text-primary)] line-clamp-2">{agent.currentTask}</p>
          </div>
        )}

        <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <AgentRuntimeBadge callsign={agent.callsign.toLowerCase()} onStartStop={onRefresh} />
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => onAssignTask(agent)}
              className="rounded bg-[var(--accent-soft)] px-2 py-1 text-[10px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              TASK
            </button>
            <button
              onClick={() => onEdit(agent.callsign)}
              className="rounded bg-[var(--bg-surface-hover)] px-2 py-1 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              EDIT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────

export default function TeamPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentSkills, setAgentSkills] = useState<Record<string, AgentSkillBadge[]>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("canvas");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Dialogs
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newAgentParent, setNewAgentParent] = useState<string | null>(null);
  const [editingCallsign, setEditingCallsign] = useState<string | null>(null);
  const [profileCallsign, setProfileCallsign] = useState<string | null>(null);
  const [taskAgent, setTaskAgent] = useState<Agent | null>(null);

  const fetchSkills = useCallback(async (agentList: Agent[]) => {
    const results: Record<string, AgentSkillBadge[]> = {};
    await Promise.all(
      agentList.map(async (agent) => {
        try {
          const res = await fetch(`/api/agents/${agent.callsign.toLowerCase()}/skills`);
          if (!res.ok) return;
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            results[agent.id] = rows
              .filter((r: { skill?: { name?: string; slug?: string; metadata?: { icon?: string } } }) => r.skill)
              .map((r: { skill: { name: string; slug: string; metadata?: { icon?: string } } }) => ({
                slug: r.skill.slug,
                name: r.skill.name,
                icon: (r.skill.metadata as { icon?: string } | null)?.icon ?? "⚡",
              }));
          }
        } catch { /* empty */ }
      })
    );
    setAgentSkills(results);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        const agentList = data.agents || [];
        setAgents(agentList);
        fetchSkills(agentList);
      }
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [fetchSkills]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const toggleCollapse = useCallback((callsign: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(callsign)) next.delete(callsign);
      else next.add(callsign);
      return next;
    });
  }, []);

  // Filter agents
  const filtered = agents.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.callsign.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.role?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const tree = buildTree(filtered);
  const activeCount = agents.filter((a) => a.status === "online" || a.status === "working").length;

  const statusFilters = [
    { key: "all", label: "ALL" },
    { key: "online", label: "ONLINE" },
    { key: "working", label: "WORKING" },
    { key: "idle", label: "IDLE" },
    { key: "offline", label: "OFFLINE" },
  ];

  function handleAddChild(parentCallsign: string) {
    setNewAgentParent(parentCallsign);
    setShowNewAgent(true);
  }

  function handleNewAgentCreated() {
    setShowNewAgent(false);
    setNewAgentParent(null);
    refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--text-tertiary)]">Loading team...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-5 p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">TEAM</h1>
            <p className="text-[11px] tracking-wider text-[var(--text-tertiary)]">
              {agents.length > 0
                ? `${activeCount} OF ${agents.length} ACTIVE · Build and manage your agent workforce`
                : "NO AGENTS — Create your first agent or deploy a blueprint"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <button
                onClick={() => setViewMode("canvas")}
                className={`px-2.5 py-1.5 text-[10px] tracking-wider transition-colors ${
                  viewMode === "canvas"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
                title="Canvas org chart"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0118 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 006 20.25h1.5M12 8.25v7.5M9 12h6" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("tree")}
                className={`px-2.5 py-1.5 text-[10px] tracking-wider transition-colors ${
                  viewMode === "tree"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
                title="Hierarchy list"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`px-2.5 py-1.5 text-[10px] tracking-wider transition-colors ${
                  viewMode === "grid"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
                title="Grid view"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
                </svg>
              </button>
            </div>

            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--accent)]"
            />

            <Link
              href="/blueprints"
              className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
            >
              BLUEPRINTS
            </Link>

            <button
              onClick={() => {
                setNewAgentParent(null);
                setShowNewAgent(true);
              }}
              className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              + NEW AGENT
            </button>
          </div>
        </div>

        {/* Status filters */}
        {agents.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {statusFilters.map((sf) => (
              <button
                key={sf.key}
                onClick={() => setStatusFilter(sf.key)}
                className={`rounded-lg px-3 py-1.5 text-[11px] tracking-wider transition-all duration-200 ${
                  statusFilter === sf.key
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
              >
                {sf.label}
                {sf.key !== "all" && (
                  <span className="ml-1.5 text-[var(--text-tertiary)]">
                    {agents.filter((a) => a.status === sf.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {viewMode === "canvas" && agents.length > 0 ? (
          <div className="-mx-4 sm:-mx-6 -mb-5 rounded-t-xl border border-[var(--border-subtle)] overflow-hidden" style={{ height: "calc(100vh - 220px)" }}>
            <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--text-tertiary)]">Loading canvas...</div>}>
              <TeamCanvas
                agents={filtered}
                agentSkills={agentSkills}
                onEdit={setProfileCallsign}
                onAddChild={handleAddChild}
                onAssignTask={setTaskAgent}
                onRefresh={refresh}
              />
            </Suspense>
          </div>
        ) : agents.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-20">
            <div className="text-4xl mb-4">🤖</div>
            <p className="text-sm text-[var(--text-secondary)]">No agents yet</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Create your first agent or deploy a team blueprint to get started.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setShowNewAgent(true)}
                className="rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
              >
                + CREATE AGENT
              </button>
              <Link
                href="/blueprints"
                className="rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                BROWSE BLUEPRINTS
              </Link>
            </div>
          </div>
        ) : viewMode === "tree" ? (
          <div className="space-y-1">
            {tree.length === 0 && search ? (
              <div className="py-12 text-center">
                <p className="text-xs text-[var(--text-tertiary)]">No agents match &quot;{search}&quot;</p>
              </div>
            ) : (
              tree.map((node) => (
                <NodeCard
                  key={node.agent.id}
                  node={node}
                  depth={0}
                  skills={agentSkills}
                  onEdit={setProfileCallsign}
                  onAddChild={handleAddChild}
                  onAssignTask={setTaskAgent}
                  onRefresh={refresh}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  onCardClick={setProfileCallsign}
                />
              ))
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agent) => (
              <GridCard
                key={agent.id}
                agent={agent}
                skills={agentSkills[agent.id] ?? []}
                onEdit={setProfileCallsign}
                onAssignTask={setTaskAgent}
                onRefresh={refresh}
                onCardClick={setProfileCallsign}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-12 text-center">
                <p className="text-xs text-[var(--text-tertiary)]">No agents match the current filters</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showNewAgent && (
        <NewAgentDialogWrapper
          companyId={getCompanyId()}
          parentCallsign={newAgentParent}
          onCreated={handleNewAgentCreated}
          onClose={() => { setShowNewAgent(false); setNewAgentParent(null); }}
        />
      )}

      {profileCallsign && (
        <AgentProfilePanel
          callsign={profileCallsign}
          onClose={() => setProfileCallsign(null)}
          onEdit={(cs) => {
            setProfileCallsign(null);
            setEditingCallsign(cs);
          }}
        />
      )}

      {editingCallsign && (
        <EditAgentDialog
          callsign={editingCallsign}
          companyId={getCompanyId()}
          onSaved={() => { setEditingCallsign(null); refresh(); }}
          onClose={() => setEditingCallsign(null)}
          onDelete={() => { setEditingCallsign(null); refresh(); }}
        />
      )}

      {taskAgent && (
        <TaskDialog
          agent={taskAgent}
          onClose={() => setTaskAgent(null)}
        />
      )}
    </div>
  );
}

// ─── NewAgentDialog wrapper that pre-sets reportsTo ─────────────────────

function NewAgentDialogWrapper({
  companyId,
  parentCallsign,
  onCreated,
  onClose,
}: {
  companyId: string | null;
  parentCallsign: string | null;
  onCreated: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      {parentCallsign && (
        <div className="fixed top-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-[var(--accent)]/20 bg-[var(--bg-primary)] px-4 py-2 text-xs text-[var(--accent)] shadow-xl">
          Adding report under <span className="font-mono font-bold">{parentCallsign.toUpperCase()}</span>
        </div>
      )}
      <NewAgentDialog
        companyId={companyId}
        onCreated={onCreated}
        onClose={onClose}
        defaultReportsTo={parentCallsign ?? undefined}
      />
    </div>
  );
}
