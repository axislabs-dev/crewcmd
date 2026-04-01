"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Agent } from "@/lib/data";

export interface AgentNodeData {
  agent: Agent;
  skills: { slug: string; name: string; icon: string }[];
  onEdit: (callsign: string) => void;
  onAddChild: (callsign: string) => void;
  onAssignTask: (agent: Agent) => void;
  onNavigate: (callsign: string) => void;
}

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

function AgentNodeComponent({ data }: NodeProps) {
  const { agent, skills, onEdit, onAddChild, onAssignTask, onNavigate } = data as unknown as AgentNodeData;

  return (
    <div className="group relative">
      {/* Target handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-[var(--bg-surface)] !border-2 !border-[var(--border-medium)] hover:!border-[var(--accent)] !-top-1.5 transition-colors"
      />

      {/* Card */}
      <div
        className="relative w-[220px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg transition-all duration-200 hover:border-[var(--border-medium)] hover:shadow-xl cursor-pointer overflow-hidden"
        onDoubleClick={() => onNavigate(agent.callsign.toLowerCase())}
      >
        {/* Color accent bar */}
        <div
          className="h-1 w-full"
          style={{ backgroundColor: agent.color }}
        />

        {/* Content */}
        <div className="p-3">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-base"
              style={{ backgroundColor: agent.color + "18" }}
            >
              {agent.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="font-mono text-[11px] font-bold tracking-wider truncate"
                  style={{ color: agent.color }}
                >
                  {agent.callsign.toUpperCase()}
                </span>
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusDotClass[agent.status] ?? statusDotClass.offline}`} />
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] truncate">{agent.title}</p>
            </div>
            <span className="text-[8px] tracking-wider text-[var(--text-tertiary)]">
              {statusLabels[agent.status] ?? "OFFLINE"}
            </span>
          </div>

          {/* Role + adapter badges */}
          <div className="flex items-center gap-1 mb-1.5 flex-wrap">
            {agent.role && (
              <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[8px] tracking-wider text-[var(--text-tertiary)] uppercase">
                {agent.role}
              </span>
            )}
            <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[8px] tracking-wider text-[var(--text-tertiary)]">
              {adapterLabels[agent.adapterType] || agent.adapterType?.toUpperCase()}
            </span>
            {agent.model && (
              <span className="rounded bg-[var(--bg-surface-hover)] px-1 py-0.5 font-mono text-[7px] text-[var(--text-tertiary)] truncate max-w-[80px]">
                {agent.model}
              </span>
            )}
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mb-1.5">
              {skills.slice(0, 3).map((s) => (
                <span
                  key={s.slug}
                  className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[7px] tracking-wider text-[var(--accent)]"
                >
                  <span className="text-[8px]">{s.icon}</span>
                  {s.name}
                </span>
              ))}
              {skills.length > 3 && (
                <span className="text-[7px] text-[var(--text-tertiary)] self-center">+{skills.length - 3}</span>
              )}
            </div>
          )}

          {/* Current task */}
          {agent.currentTask && (
            <div className="rounded bg-[var(--bg-surface-hover)] px-2 py-1 mb-1.5">
              <p className="text-[8px] text-[var(--text-secondary)] line-clamp-1">{agent.currentTask}</p>
            </div>
          )}

          {/* Hover actions */}
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onAssignTask(agent); }}
              className="rounded bg-[var(--bg-surface-hover)] p-1 text-[var(--text-tertiary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors"
              title="Assign task"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAddChild(agent.callsign); }}
              className="rounded bg-[var(--bg-surface-hover)] p-1 text-[var(--text-tertiary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors"
              title="Add direct report"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(agent.callsign); }}
              className="rounded bg-[var(--bg-surface-hover)] p-1 text-[var(--text-tertiary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors"
              title="Edit agent"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-[var(--bg-surface)] !border-2 !border-[var(--border-medium)] hover:!border-[var(--accent)] !-bottom-1.5 transition-colors"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
