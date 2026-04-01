"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Agent {
  id: string;
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  color: string;
  role: string;
  status: string;
  reportsTo: string | null;
}

interface TreeNode {
  agent: Agent;
  children: TreeNode[];
}

function buildTree(agents: Agent[]): TreeNode[] {
  const byCallsign = new Map<string, Agent>();
  for (const a of agents) byCallsign.set(a.callsign, a);

  const childrenOf = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const parent = a.reportsTo ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(a);
  }

  function build(parentCallsign: string | null): TreeNode[] {
    const kids = childrenOf.get(parentCallsign) ?? [];
    return kids.map((agent) => ({
      agent,
      children: build(agent.callsign),
    }));
  }

  // Root nodes: agents whose reportsTo is null or references a non-existent callsign
  const roots: Agent[] = [];
  const orphans: Agent[] = [];
  for (const a of agents) {
    if (!a.reportsTo) {
      roots.push(a);
    } else if (!byCallsign.has(a.reportsTo)) {
      orphans.push(a);
    }
  }

  const tree = roots.map((agent) => ({
    agent,
    children: build(agent.callsign),
  }));

  // Append orphans as roots (their parent doesn't exist)
  for (const a of orphans) {
    tree.push({ agent: a, children: build(a.callsign) });
  }

  return tree;
}

function statusDot(status: string) {
  switch (status) {
    case "active":
    case "running":
      return "bg-emerald-400";
    case "idle":
      return "bg-amber-400";
    default:
      return "bg-[var(--text-tertiary)]/40";
  }
}

function NodeCard({ node, depth }: { node: TreeNode; depth: number }) {
  const { agent } = node;
  const reportCount = node.children.length;

  return (
    <div className={depth > 0 ? "ml-8 border-l border-[var(--border-subtle)] pl-4" : ""}>
      <Link
        href={`/agents/${agent.callsign}`}
        className="group flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors hover:border-[var(--accent-medium)] hover:bg-[var(--bg-surface)]"
      >
        {/* Avatar */}
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: agent.color + "20" }}
        >
          {agent.emoji}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
              {agent.name}
            </span>
            <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
              {agent.callsign}
            </span>
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot(agent.status)}`} />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)]">{agent.title}</p>
        </div>

        {/* Report count */}
        {reportCount > 0 && (
          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
            {reportCount} report{reportCount !== 1 ? "s" : ""}
          </span>
        )}

        {/* Role badge */}
        <span className="rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
          {agent.role?.toUpperCase() ?? "AGENT"}
        </span>
      </Link>

      {/* Children */}
      {node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <NodeCard key={child.agent.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [agentCount, setAgentCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        const agents: Agent[] = Array.isArray(data) ? data : data.agents ?? [];
        setAgentCount(agents.length);
        setTree(buildTree(agents));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-wider text-[var(--accent)]">TEAM</h1>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {agentCount} agent{agentCount !== 1 ? "s" : ""} — hierarchy based on reporting structure
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
        >
          + ADD AGENT
        </Link>
      </div>

      {/* Tree */}
      <div className="mt-6 space-y-1">
        {tree.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-medium)] py-16 text-center">
            <p className="text-xs text-[var(--text-tertiary)]">No agents yet</p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Create agents or deploy a blueprint to build your team.
            </p>
            <Link
              href="/agents/new"
              className="mt-4 inline-block rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)]"
            >
              CREATE FIRST AGENT
            </Link>
          </div>
        ) : (
          tree.map((node) => <NodeCard key={node.agent.id} node={node} depth={0} />)
        )}
      </div>
    </div>
  );
}
