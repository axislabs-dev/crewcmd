"use client";

import { useState, useRef, useEffect, useMemo, useId } from "react";
import type { Agent } from "@/lib/data";
import {
  buildAgentHierarchy,
  findDefaultHierarchyAgent,
} from "@/lib/agent-hierarchy";
import { useSessionBrowserStore } from "@/lib/session-browser-store";
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

function buildTree(agents: Agent[]): AgentTreeNode[] {
  const toTree = (
    nodes: ReturnType<typeof buildAgentHierarchy>,
    depth: number
  ): AgentTreeNode[] =>
    nodes.map((node) => ({
      agent: node.agent,
      depth,
      children: toTree(node.children, depth + 1),
    }));

  return toTree(buildAgentHierarchy(agents), 0);
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
  const panelId = useId();

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
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
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
        <>
          <button
            type="button"
            aria-label="Close agent selector"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            id={panelId}
            role="dialog"
            aria-label="Agent selector"
            className="fixed inset-x-3 bottom-3 top-auto z-50 max-h-[min(70vh,32rem)] overflow-y-auto rounded-2xl border border-[var(--border-medium)] py-1 shadow-2xl md:inset-auto md:left-4 md:top-16 md:w-[28rem] md:max-w-[calc(100vw-2rem)] md:max-h-[min(70vh,36rem)]"
            style={{ backgroundColor: "var(--bg-primary)" }}
          >
          {/* Tab toggle */}
          <div className="border-b border-[var(--border-subtle)] px-2 pt-2 md:hidden">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-[var(--border-medium)]" />
            <div className="px-2 pb-2">
              <div className="text-[10px] font-mono tracking-[0.24em] text-[var(--text-tertiary)]">
                ACTIVE CHAT
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                <span>{agentEmoji}</span>
                <span>{agentCallsign}</span>
              </div>
            </div>
          </div>

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
                    type="button"
                    onClick={() => {
                      onSelect(agent);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-3 text-left text-[12px] transition-colors hover:bg-[var(--bg-surface-hover)] md:py-2 ${
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
                const session = useSessionBrowserStore
                  .getState()
                  .sessions.find((entry) => entry.key === sessionKey);
                const sessionAgent = session
                  ? agents.find(
                      (agent) =>
                        agent.callsign.toLowerCase() ===
                        session.agentId.toLowerCase()
                    )
                  : null;
                const nextAgent = sessionAgent ?? selectedAgent ?? agents[0];
                if (nextAgent) onSelect(nextAgent, sessionKey);
                setOpen(false);
              }}
              selectedAgentCallsign={selectedAgent?.callsign ?? null}
            />
          )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Find the default (top-level) agent — the one with no reportsTo.
 * Falls back to first agent if none found.
 */
export function findDefaultAgent(agents: Agent[]): Agent | null {
  return findDefaultHierarchyAgent(agents);
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
