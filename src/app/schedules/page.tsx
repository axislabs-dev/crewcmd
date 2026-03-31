"use client";

import { useEffect, useState, useCallback } from "react";

interface CronSchedule {
  kind: string;
  everyMs?: number;
  anchorMs?: number;
  cron?: string;
}

interface CronJob {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: string;
  wakeMode: string;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
  };
}

function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(ms / 86400000)}d`;
}

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === "every" && schedule.everyMs) {
    return `Every ${formatInterval(schedule.everyMs)}`;
  }
  if (schedule.kind === "cron" && schedule.cron) {
    return schedule.cron;
  }
  return schedule.kind;
}

function formatTimestamp(ms: number | undefined): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const now = Date.now();
  const diffMs = ms - now;

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (Math.abs(diffMs) < 60000) return "just now";

  if (diffMs > 0) {
    return `${timeStr} (in ${formatInterval(diffMs)})`;
  }

  return `${timeStr} (${formatInterval(Math.abs(diffMs))} ago)`;
}

export default function SchedulesPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  async function toggleJob(jobId: string, currentlyEnabled: boolean) {
    setToggling(jobId);
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, enabled: !currentlyEnabled } : j))
    );

    try {
      const res = await fetch(`/api/schedules/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      if (!res.ok) {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, enabled: currentlyEnabled } : j))
        );
      }
    } catch {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, enabled: currentlyEnabled } : j))
      );
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-mono text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
              SCHEDULES
            </h1>
            <p className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
              {jobs.filter((j) => j.enabled).length} ACTIVE
              &middot; {jobs.length} TOTAL CRON JOBS
            </p>
          </div>

          <button
            onClick={() => { setLoading(true); refresh(); }}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-all duration-200 hover:border-[var(--accent-medium)] hover:text-[var(--accent)]"
          >
            <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
            REFRESH
          </button>
        </div>

        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-16">
            <svg className="mb-4 h-12 w-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <p className="text-sm text-[var(--text-tertiary)]">No cron jobs found</p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Connect OpenClaw to manage scheduled jobs
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const isToggling = toggling === job.id;

              return (
                <div
                  key={job.id}
                  className={`glass-card p-5 transition-all duration-200 ${
                    !job.enabled ? "opacity-50" : ""
                  }`}
                  style={{
                    borderColor: job.enabled ? "rgba(0, 240, 255, 0.08)" : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: job.enabled ? "#00ff88" : "#555",
                            boxShadow: job.enabled ? "0 0 8px rgba(0, 255, 136, 0.4)" : "none",
                          }}
                        />
                        <h3 className="font-mono text-sm font-bold tracking-wider text-[var(--text-primary)]">
                          {job.name.toUpperCase()}
                        </h3>
                        <span className="rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
                          {job.sessionTarget.toUpperCase()}
                        </span>
                      </div>

                      {job.description && (
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                          {job.description}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                        <div>
                          <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
                            SCHEDULE
                          </span>
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--accent)]/70">
                            {formatSchedule(job.schedule)}
                          </div>
                        </div>
                        <div>
                          <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
                            NEXT RUN
                          </span>
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                            {job.enabled
                              ? formatTimestamp(job.state.nextRunAtMs)
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
                            LAST RUN
                          </span>
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                            {formatTimestamp(job.state.lastRunAtMs)}
                          </div>
                        </div>
                        <div>
                          <span className="font-mono text-[9px] tracking-wider text-[var(--text-tertiary)]">
                            STATUS
                          </span>
                          <div className="mt-0.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wider ${
                                job.enabled
                                  ? "border-green-400/20 bg-green-400/10 text-green-400"
                                  : "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                              }`}
                            >
                              {job.enabled ? "ENABLED" : "DISABLED"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleJob(job.id, job.enabled)}
                      disabled={isToggling}
                      className={`relative shrink-0 rounded-full transition-all duration-300 ${
                        job.enabled
                          ? "bg-[var(--accent-soft)] shadow-[0_0_12px_rgba(0,240,255,0.15)]"
                          : "bg-[var(--bg-surface-hover)]"
                      }`}
                      style={{ width: 44, height: 24 }}
                      title={job.enabled ? "Disable" : "Enable"}
                    >
                      <div
                        className={`absolute top-1 h-4 w-4 rounded-full transition-all duration-300 ${
                          job.enabled
                            ? "left-6 bg-neo shadow-[0_0_6px_rgba(0,240,255,0.5)]"
                            : "left-1 bg-[var(--text-tertiary)]"
                        } ${isToggling ? "opacity-50" : ""}`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
