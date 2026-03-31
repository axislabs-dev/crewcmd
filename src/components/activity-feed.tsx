"use client";

import { useState } from "react";
import type { Activity, Agent } from "@/lib/data";
import { timeAgo } from "@/lib/utils";

interface ActivityFeedProps {
  activities: Activity[];
  agents: Agent[];
}

const actionIcons: Record<string, string> = {
  deploy: "🚀",
  review: "🔍",
  publish: "📝",
  create: "✨",
  analyze: "📊",
  plan: "📋",
  commit: "💾",
  outreach: "📧",
  assign: "🎯",
  optimize: "⚡",
  comment: "💬",
  task_assigned: "🎯",
  task_inbox: "📥",
  task_queued: "⏳",
  task_in_progress: "🔨",
  task_review: "🔍",
  task_done: "✅",
  task_completed: "✅",
  timer_start: "▶️",
  time_logged: "⏱️",
};

export function ActivityFeed({ activities, agents }: ActivityFeedProps) {
  const [filter, setFilter] = useState<string>("all");

  // Activity log stores agent callsigns (text), not UUIDs.
  // Build a lookup map by callsign (lowercase) for reliable matching.
  const agentByCallsign = new Map(agents.map((a) => [a.callsign.toLowerCase(), a]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const filtered =
    filter === "all"
      ? activities
      : activities.filter(
          (a) =>
            a.agentId === filter ||
            a.agentId?.toLowerCase() === filter.toLowerCase()
        );

  return (
    <section className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
          Activity Feed
        </h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-medium)]"
        >
          <option value="all">ALL AGENTS</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.callsign.toLowerCase()}>
              {agent.emoji} {agent.callsign.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered.map((activity, index) => {
          // Look up by callsign first (text agentId), fall back to UUID
        const agent =
          agentByCallsign.get(activity.agentId?.toLowerCase()) ??
          agentById.get(activity.agentId);
          return (
            <div
              key={activity.id}
              className="animate-fade-in glass-card group relative overflow-hidden p-3 transition-all duration-200 hover:bg-[var(--bg-surface-hover)]"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div
                className="absolute left-0 top-0 h-full w-[3px]"
                style={{ backgroundColor: agent?.color ?? "#555" }}
              />

              <div className="ml-2 flex items-start gap-3">
                <span className="mt-0.5 text-sm">
                  {actionIcons[activity.actionType] ?? "\ud83d\udccc"}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] font-bold tracking-wider"
                      style={{ color: agent?.color ?? "#888" }}
                    >
                      {agent?.callsign.toUpperCase() ?? "UNKNOWN"}
                    </span>
                    <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] uppercase">
                      {activity.actionType}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {activity.description}
                  </p>
                  <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                    {timeAgo(activity.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            No activity found
          </div>
        )}
      </div>
    </section>
  );
}
