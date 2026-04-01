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
          const raw = data.adapters;
          // API may return an object keyed by adapter or an array
          const list = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object"
              ? Object.entries(raw).map(([key, val]) => ({ key, ...(val as Record<string, unknown>) }))
              : [];
          setAdapters(list as AdapterAvailability[]);
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

  const available = adapters.filter((a) => a.available);

  if (available.length === 0) return null;

  return (
    <div className="glass-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] tracking-wider text-[var(--text-secondary)] uppercase shrink-0">
          Available Tools:
        </span>
        {available.map((adapter) => (
          <span
            key={adapter.key}
            className="inline-flex items-center gap-1 text-[11px] tracking-wider text-[var(--text-primary)]"
          >
            <span>{"\u2705"}</span>
            {adapter.name}
          </span>
        ))}
      </div>
    </div>
  );
}
