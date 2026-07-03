"use client";

import { useEffect, useState } from "react";

interface RuntimeHealth {
  ok: boolean;
  status: string;
}

type HealthState =
  | { kind: "loading" }
  | { kind: "ready"; health: RuntimeHealth }
  | { kind: "error" }
  | { kind: "unsupported" };

interface RuntimeHealthIndicatorProps {
  runtimeId: string;
  runtimeType: string;
  className?: string;
}

export function RuntimeHealthIndicator({ runtimeId, runtimeType, className }: RuntimeHealthIndicatorProps) {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    if (runtimeType !== "hermes") {
      setState({ kind: "unsupported" });
      return;
    }

    let active = true;
    setState({ kind: "loading" });

    async function loadHealth() {
      try {
        const response = await fetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/health`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!active) return;

        if (response.status === 501) {
          setState({ kind: "unsupported" });
          return;
        }
        if (!response.ok || !isRuntimeHealth(data.health)) {
          setState({ kind: "error" });
          return;
        }

        setState({ kind: "ready", health: data.health });
      } catch {
        if (active) setState({ kind: "error" });
      }
    }

    void loadHealth();
    return () => {
      active = false;
    };
  }, [runtimeId, runtimeType]);

  if (state.kind === "unsupported") return null;

  const label = healthLabel(state);
  const toneClass = healthToneClass(state);

  return (
    <span
      title="Runtime health"
      className={joinClasses(
        "rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wider",
        toneClass,
        className
      )}
    >
      {label}
    </span>
  );
}

function healthLabel(state: HealthState) {
  if (state.kind === "loading") return "CHECKING";
  if (state.kind === "error") return "HEALTH UNKNOWN";
  if (state.kind === "unsupported") return "";
  return normalizeStatusLabel(state.health.status);
}

function healthToneClass(state: HealthState) {
  if (state.kind === "loading") return "bg-sky-500/15 text-sky-300";
  if (state.kind === "error") return "bg-amber-500/20 text-amber-400";
  if (state.kind === "unsupported") return "bg-[var(--bg-surface)] text-[var(--text-tertiary)]";
  return state.health.ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400";
}

function normalizeStatusLabel(status: string) {
  const normalized = status.trim().replace(/[_\s]+/g, " ");
  return normalized ? normalized.toUpperCase() : "UNKNOWN";
}

function isRuntimeHealth(value: unknown): value is RuntimeHealth {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" && typeof record.status === "string";
}

function joinClasses(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}
