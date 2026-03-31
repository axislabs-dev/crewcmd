"use client";

import { useState, useEffect } from "react";

interface AdapterAvailability {
  name: string;
  key: string;
  available: boolean;
}

/**
 * Banner showing which CLI tools (adapters) are detected on the system.
 * Fetches from GET /api/runtime/check and caches for 60s.
 */
export function AdapterCheck() {
  const [adapters, setAdapters] = useState<AdapterAvailability[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/runtime/check", {
          cache: "default",
          next: { revalidate: 60 },
        } as RequestInit);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setAdapters(data.adapters || []);
        } else if (!cancelled) {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  if (error || !adapters) return null;

  const hasUnavailable = adapters.some((a) => !a.available);

  return (
    <div className="glass-card p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase shrink-0">
          Detected Tools:
        </span>
        {adapters.map((adapter) => (
          <span
            key={adapter.key}
            className={`inline-flex items-center gap-1 text-[11px] tracking-wider ${
              adapter.available
                ? "text-[var(--text-secondary)]"
                : "text-[var(--text-tertiary)] opacity-50"
            }`}
          >
            <span>{adapter.available ? "\u2705" : "\u274C"}</span>
            {adapter.name}
          </span>
        ))}
      </div>
      {hasUnavailable && (
        <p className="text-[10px] text-[var(--text-tertiary)]">
          Agents using unavailable tools cannot be started. Install the tool first.
        </p>
      )}
    </div>
  );
}
