"use client";

import { useEffect, useState } from "react";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; skills: number; toolsets: number }
  | { kind: "error" }
  | { kind: "unsupported" };

interface RuntimeDiscoverySummaryProps {
  runtimeId: string;
  runtimeType: string;
  className?: string;
}

export function RuntimeDiscoverySummary({ runtimeId, runtimeType, className }: RuntimeDiscoverySummaryProps) {
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });

  useEffect(() => {
    if (runtimeType !== "hermes") {
      setState({ kind: "unsupported" });
      return;
    }

    let active = true;
    setState({ kind: "loading" });

    async function loadDiscovery() {
      try {
        const [skills, toolsets] = await Promise.all([
          fetchRuntimeListCount(runtimeId, "skills"),
          fetchRuntimeListCount(runtimeId, "toolsets"),
        ]);
        if (active) setState({ kind: "ready", skills, toolsets });
      } catch (error) {
        if (active) {
          setState(isUnsupportedDiscovery(error) ? { kind: "unsupported" } : { kind: "error" });
        }
      }
    }

    void loadDiscovery();
    return () => {
      active = false;
    };
  }, [runtimeId, runtimeType]);

  if (state.kind === "unsupported") return null;

  return (
    <p className={className} title="Runtime discovery">
      {discoveryLabel(state)}
    </p>
  );
}

async function fetchRuntimeListCount(runtimeId: string, listName: "skills" | "toolsets") {
  const response = await fetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/${listName}`, {
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 501) throw new UnsupportedDiscoveryError();
  if (!response.ok) throw new Error(`Runtime ${listName} discovery failed`);

  const items = data[listName];
  return Array.isArray(items) ? items.length : 0;
}

function discoveryLabel(state: DiscoveryState) {
  if (state.kind === "loading") return "Loading discovery...";
  if (state.kind === "error") return "Discovery unavailable";
  if (state.kind === "unsupported") return "";
  return `${state.skills} ${pluralize("skill", state.skills)} · ${state.toolsets} ${pluralize("toolset", state.toolsets)}`;
}

function pluralize(value: string, count: number) {
  return count === 1 ? value : `${value}s`;
}

class UnsupportedDiscoveryError extends Error {}

function isUnsupportedDiscovery(error: unknown) {
  return error instanceof UnsupportedDiscoveryError;
}
