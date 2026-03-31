"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentRuntimeStatus } from "./agent-control-panel";

interface AgentRuntimeBadgeProps {
  /** Agent callsign to check runtime status */
  callsign: string;
  /** Compact mode hides uptime text */
  compact?: boolean;
  /** Callback when start/stop action completes */
  onStartStop?: () => void;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "";
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/**
 * Compact runtime status badge for agent cards.
 * Shows running/stopped/error state with a popover for quick start/stop.
 */
export function AgentRuntimeBadge({ callsign, compact = false, onStartStop }: AgentRuntimeBadgeProps) {
  const [status, setStatus] = useState<AgentRuntimeStatus | null>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${callsign}/status`);
      if (res.ok) {
        setStatus(await res.json());
      } else {
        setStatus({ status: "stopped", pid: null, startedAt: null, error: null });
      }
    } catch {
      setStatus({ status: "stopped", pid: null, startedAt: null, error: null });
    }
  }, [callsign]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    if (showPopover) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showPopover]);

  async function handleAction(action: "start" | "stop") {
    setActionLoading(true);
    try {
      await fetch(`/api/agents/${callsign}/${action}`, { method: "POST" });
      await fetchStatus();
      onStartStop?.();
    } catch {
      // Action failed silently
    } finally {
      setActionLoading(false);
      setShowPopover(false);
    }
  }

  if (!status) return null;

  const runtimeStatus = status.status;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowPopover(!showPopover);
        }}
        className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] tracking-wider transition-colors hover:bg-[var(--bg-surface-hover)]"
      >
        {runtimeStatus === "running" && (
          <>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            <span className="text-green-500">RUN</span>
            {!compact && <span className="text-[var(--text-tertiary)]">{formatUptime(status.startedAt)}</span>}
          </>
        )}
        {runtimeStatus === "stopped" && (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#555]" />
            <span className="text-[var(--text-tertiary)]">STOPPED</span>
          </>
        )}
        {runtimeStatus === "starting" && (
          <>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
            <span className="text-yellow-500">STARTING</span>
          </>
        )}
        {runtimeStatus === "error" && (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="text-red-400">ERROR</span>
          </>
        )}
      </button>

      {showPopover && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-primary)] p-2 shadow-xl"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {(runtimeStatus === "stopped" || runtimeStatus === "error") && (
            <button
              onClick={() => handleAction("start")}
              disabled={actionLoading}
              className="w-full rounded px-2 py-1.5 text-left text-[11px] tracking-wider text-green-500 transition-colors hover:bg-green-500/10 disabled:opacity-50"
            >
              {actionLoading ? "..." : "START"}
            </button>
          )}
          {(runtimeStatus === "running" || runtimeStatus === "starting") && (
            <button
              onClick={() => handleAction("stop")}
              disabled={actionLoading}
              className="w-full rounded px-2 py-1.5 text-left text-[11px] tracking-wider text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              {actionLoading ? "..." : "STOP"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
