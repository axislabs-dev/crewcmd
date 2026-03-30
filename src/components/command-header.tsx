"use client";

import { useEffect, useState } from "react";
import type { Agent, Task } from "@/lib/data";

interface CommandHeaderProps {
  agents: Agent[];
  tasks: Task[];
}

export function CommandHeader({ agents, tasks }: CommandHeaderProps) {
  const [time, setTime] = useState<string>("");
  const [date, setDate] = useState<string>("");

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
      setDate(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeAgents = agents.filter(
    (a) => a.status === "online" || a.status === "working"
  ).length;
  const tasksInProgress = tasks.filter(
    (t) => t.status === "in_progress"
  ).length;
  const totalTasks = tasks.length;

  return (
    <header className="glass-card border-b border-border-subtle px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div
              className="h-3 w-3 rounded-full bg-neo"
              style={{
                boxShadow: "0 0 12px rgba(0, 240, 255, 0.6)",
              }}
            />
            <h1 className="glow-text-neo font-mono text-lg tracking-[0.2em] font-bold text-neo">
              AXISLABS TACTICAL SQUAD
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-6">
            <StatBlock label="AGENTS ONLINE" value={`${activeAgents}/${agents.length}`} />
            <Divider />
            <StatBlock label="IN PROGRESS" value={String(tasksInProgress)} />
            <Divider />
            <StatBlock label="TOTAL TASKS" value={String(totalTasks)} />
          </div>

          <div className="flex flex-col items-end">
            <span className="font-mono text-xl font-bold text-white tabular-nums">
              {time}
            </span>
            <span className="font-mono text-xs text-white/40">{date}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-mono text-[10px] tracking-widest text-white/30 uppercase">
        {label}
      </span>
      <span className="font-mono text-lg font-bold text-white">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-8 w-px bg-white/10" />;
}
