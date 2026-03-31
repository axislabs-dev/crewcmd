"use client";

import { useState, useEffect, useRef } from "react";

interface Company {
  id: string;
  name: string;
  mission: string | null;
  memberRole: string;
}

export function CompanySwitcher() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Company[]) => {
        setCompanies(data);
        // Read active company from cookie
        const cookie = document.cookie
          .split("; ")
          .find((c) => c.startsWith("active_company="));
        const cookieId = cookie?.split("=")[1];
        if (cookieId && data.some((c) => c.id === cookieId)) {
          setActiveId(cookieId);
        } else if (data.length > 0) {
          // Auto-select first company
          setActiveId(data[0].id);
          document.cookie = `active_company=${data[0].id};path=/;max-age=${60 * 60 * 24 * 365}`;
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (companies.length === 0) return null;

  const active = companies.find((c) => c.id === activeId);

  function switchCompany(id: string) {
    setActiveId(id);
    document.cookie = `active_company=${id};path=/;max-age=${60 * 60 * 24 * 365}`;
    setOpen(false);
    // Reload to apply company context across the app
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-soft)] font-mono text-[10px] font-bold text-[var(--accent)]">
          {active?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] tracking-wider text-[var(--text-primary)]">
            {active?.name ?? "Select company"}
          </p>
          {active?.mission && (
            <p className="truncate text-[8px] tracking-wider text-[var(--text-tertiary)]">
              {active.mission}
            </p>
          )}
        </div>
        <svg
          className={`h-3 w-3 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-primary)] py-1 shadow-xl backdrop-blur-xl">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => switchCompany(c.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)] ${
                c.id === activeId ? "bg-neo/5" : ""
              }`}
            >
              <div className="flex h-5 w-5 items-center justify-center rounded bg-neo/15 font-mono text-[9px] font-bold text-[var(--accent)]">
                {c.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] tracking-wider text-[var(--text-primary)]">
                  {c.name}
                </p>
              </div>
              {c.id === activeId && (
                <div
                  className="h-1.5 w-1.5 rounded-full bg-neo"
                  style={{ boxShadow: "0 0 6px rgba(0, 240, 255, 0.6)" }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
