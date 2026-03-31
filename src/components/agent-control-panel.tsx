"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/** Runtime status returned by the agent status API */
export interface AgentRuntimeStatus {
  status: "running" | "stopped" | "starting" | "error";
  pid: number | null;
  startedAt: string | null;
  error: string | null;
}

interface AgentControlPanelProps {
  callsign: string;
  onStatusChange?: (status: AgentRuntimeStatus) => void;
}

const STATUS_CONFIG = {
  running: { label: "RUNNING", dotClass: "bg-green-500", dotPulse: true },
  stopped: { label: "STOPPED", dotClass: "bg-red-500", dotPulse: false },
  starting: { label: "STARTING", dotClass: "bg-yellow-500", dotPulse: true },
  error: { label: "ERROR", dotClass: "bg-red-500", dotPulse: false },
} as const;

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "--";
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Control panel for starting, stopping, and monitoring an agent's runtime.
 * Polls the status endpoint every 5s when the agent is running.
 */
export function AgentControlPanel({ callsign, onStatusChange }: AgentControlPanelProps) {
  const [status, setStatus] = useState<AgentRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${callsign}/status`);
      if (res.ok) {
        const data: AgentRuntimeStatus = await res.json();
        setStatus(data);
        onStatusChange?.(data);
        setError(null);
      } else {
        setStatus({ status: "stopped", pid: null, startedAt: null, error: null });
      }
    } catch {
      setError("Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, [callsign, onStatusChange]);

  // Poll every 5s when running or starting
  useEffect(() => {
    fetchStatus();

    intervalRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  async function handleAction(action: "start" | "stop" | "restart") {
    setActionLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${callsign}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as Record<string, string>).error || `Failed to ${action} agent`);
      }
      // Re-fetch status immediately
      await fetchStatus();
    } catch {
      setError(`Failed to ${action} agent`);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-[var(--text-tertiary)]" />
          <span className="text-xs text-[var(--text-tertiary)] animate-pulse">LOADING STATUS...</span>
        </div>
      </div>
    );
  }

  const runtimeStatus = status?.status ?? "stopped";
  const config = STATUS_CONFIG[runtimeStatus];

  return (
    <div className="glass-card p-4 space-y-3">
      {/* Status bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${config.dotClass} ${config.dotPulse ? "animate-pulse" : ""}`}
          />
          <span className="font-mono text-xs font-bold tracking-wider text-[var(--text-primary)]">
            {config.label}
          </span>
          {status?.pid && (
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              PID {status.pid}
            </span>
          )}
          {runtimeStatus === "running" && status?.startedAt && (
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {formatUptime(status.startedAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction("start")}
            disabled={runtimeStatus === "running" || runtimeStatus === "starting" || actionLoading !== null}
            className="rounded-lg border border-green-500/30 px-3 py-1.5 text-[11px] tracking-wider text-green-500 transition-colors hover:bg-green-500/10 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            {actionLoading === "start" ? "STARTING..." : "START"}
          </button>
          <button
            onClick={() => handleAction("stop")}
            disabled={runtimeStatus === "stopped" || actionLoading !== null}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-[11px] tracking-wider text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            {actionLoading === "stop" ? "STOPPING..." : "STOP"}
          </button>
          <button
            onClick={() => handleAction("restart")}
            disabled={runtimeStatus === "stopped" || actionLoading !== null}
            className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-[11px] tracking-wider text-amber-500 transition-colors hover:bg-amber-500/10 disabled:opacity-35 disabled:cursor-not-allowed"
          >
            {actionLoading === "restart" ? "RESTARTING..." : "RESTART"}
          </button>
        </div>
      </div>

      {/* Error display */}
      {(error || status?.error) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error || status?.error}
        </div>
      )}
    </div>
  );
}
