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
      return "bg-[var(--success)]";
    case "idle":
      return "bg-[var(--warning)]";
    default:
      return "bg-[var(--text-tertiary)]";
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
  const agentSwatch = selectedAgent?.color || "var(--accent)";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-medium)] bg-[var(--control-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] transition-all hover:border-[var(--border-strong)] hover:bg-[var(--control-bg-hover)]"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: agentSwatch }}
          aria-hidden="true"
        />
        <span className="text-[13px]">{agentEmoji}</span>
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
            className="absolute left-0 top-full z-50 mt-2 max-h-[min(calc(100dvh-var(--mobile-app-bar-height)-6rem),32rem)] w-[min(calc(100vw-1.5rem),28rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-medium)] py-1 shadow-2xl md:fixed md:inset-auto md:left-4 md:top-16 md:mt-0 md:w-[28rem] md:max-w-[calc(100vw-2rem)] md:max-h-[min(70vh,36rem)]"
            style={{ backgroundColor: "var(--bg-primary)" }}
          >
          {/* Tab toggle */}
          <div className="border-b border-[var(--border-subtle)] px-2 pt-2 md:hidden">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-[var(--border-medium)]" />
            <div className="px-2 pb-2">
              <div className="text-[10px] font-medium text-[var(--text-tertiary)]">
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
                className={`flex-1 rounded-[var(--radius-control)] px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                  tab === t
                    ? "bg-[var(--selected-bg)] text-[var(--selected-text)]"
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
                        ? "bg-[var(--selected-bg)] border-l-2 border-l-[var(--accent)]"
                        : ""
                    }`}
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                  >
                    <span className="text-base shrink-0">{agent.emoji}</span>

                    <div className="flex flex-1 items-center gap-2 overflow-hidden">
                      <span className={`h-2 w-2 shrink-0 rounded-full`} style={{ backgroundColor: agent.color }} />
                      <span className={`text-[var(--text-primary)] ${isSelected ? "font-semibold" : "font-medium"}`}>
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
