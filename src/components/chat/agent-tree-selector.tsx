"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { Agent } from "@/lib/data";
import { SessionListDropdown } from "./session-list-dropdown";

interface AgentTreeNode {
  agent: Agent;
  children: AgentTreeNode[];
  depth: number;
}

interface AgentTreeSelectorProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelect: (agent: Agent, sessionKey?: string | null) => void;
  unreadCounts: Record<string, number>;
}

function compareAgents(a: Agent, b: Agent): number {
  return a.callsign.localeCompare(b.callsign, undefined, { sensitivity: "base" });
}

function buildTree(agents: Agent[]): AgentTreeNode[] {
  const sortedAgents = [...agents].sort(compareAgents);

  // Find children for a given agent, with stable sibling order
  const childrenOf = (parentCallsign: string | null): Agent[] =>
    sortedAgents.filter((a) => {
      if (!parentCallsign) return !a.reportsTo;
      return a.reportsTo?.toLowerCase() === parentCallsign.toLowerCase();
    });

  function buildNodes(parentCallsign: string | null, depth: number): AgentTreeNode[] {
    return childrenOf(parentCallsign).map((agent) => ({
      agent,
      depth,
      children: buildNodes(agent.callsign, depth + 1),
    }));
  }

  const roots = buildNodes(null, 0);

  // If no roots found (all agents have reportsTo set to non-existent parents),
  // fall back to flat list
  if (roots.length === 0) {
    return sortedAgents.map((agent) => ({ agent, depth: 0, children: [] }));
  }

  return roots;
}

function flattenTree(nodes: AgentTreeNode[]): AgentTreeNode[] {
  const result: AgentTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenTree(node.children));
  }
  return result;
}

const statusColor = (status: string) => {
  switch (status) {
    case "online":
    case "working":
      return "bg-green-400";
    case "idle":
      return "bg-yellow-400";
    default:
      return "bg-zinc-500";
  }
};

export function AgentTreeSelector({
  agents,
  selectedAgent,
  onSelect,
  unreadCounts,
}: AgentTreeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"agents" | "sessions">("agents");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tree = useMemo(() => buildTree(agents), [agents]);
  const flatNodes = useMemo(() => flattenTree(tree), [tree]);

  const agentCallsign = selectedAgent?.callsign || "MAIN";
  const agentEmoji = selectedAgent?.emoji || "💬";
  const agentColor = selectedAgent?.color || "#00f0ff";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-mono font-bold tracking-wider transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)]"
        style={{ color: agentColor }}
      >
        <span>{agentEmoji}</span>
        <span>{agentCallsign}</span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[280px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border-medium)] py-1 shadow-2xl" style={{ backgroundColor: "var(--bg-primary)" }}>
          {/* Tab toggle */}
          <div className="flex gap-0 px-2 py-1.5 border-b border-[var(--border-subtle)]">
            {(["agents", "sessions"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md px-3 py-1 text-[11px] font-mono tracking-wider uppercase transition-colors ${
                  tab === t
                    ? "bg-[var(--bg-surface-hover)] text-[var(--accent)] font-bold"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "agents" ? (
            flatNodes.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
                No agents available
              </div>
            ) : (
              flatNodes.map(({ agent, depth }) => {
                const isSelected = selectedAgent?.id === agent.id;
                const unread = unreadCounts[agent.callsign.toLowerCase()] || 0;

                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      onSelect(agent);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--bg-surface-hover)] ${
                      isSelected
                        ? "bg-[var(--bg-surface-hover)] border-l-2 border-l-[var(--accent)]"
                        : ""
                    }`}
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                  >
                    <span className="text-base shrink-0">{agent.emoji}</span>

                    <div className="flex flex-1 items-center gap-2 overflow-hidden">
                      <span
                        className={`font-mono tracking-wider ${isSelected ? "font-bold" : "font-medium"}`}
                        style={{ color: agent.color }}
                      >
                        {agent.callsign}
                      </span>
                      <span className="truncate text-[var(--text-tertiary)]">
                        {agent.title || agent.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {unread > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${statusColor(agent.status)}`}
                      />
                    </div>
                  </button>
                );
              })
            )
          ) : (
            <SessionListDropdown
              onSelectSession={(sessionKey) => {
                // Also select the current agent so it looks right in the header
                // The session key is passed separately for routing
                if (selectedAgent) {
                  onSelect(selectedAgent, sessionKey);
                }
                setOpen(false);
              }}
              selectedAgentCallsign={selectedAgent?.callsign ?? null}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Find the default (top-level) agent — the one with no reportsTo.
 * Falls back to first agent if none found.
 */
export function findDefaultAgent(agents: Agent[]): Agent | null {
  if (agents.length === 0) return null;
  const sortedAgents = [...agents].sort(compareAgents);
  return sortedAgents.find((a) => !a.reportsTo) || sortedAgents[0];
}

/**
 * Find an agent's parent by callsign.
 */
export function findParentAgent(agent: Agent, agents: Agent[]): Agent | null {
  if (!agent.reportsTo) return null;
  return (
    agents.find(
      (a) => a.callsign.toLowerCase() === agent.reportsTo?.toLowerCase()
    ) || null
  );
}
