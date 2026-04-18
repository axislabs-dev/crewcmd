"use client";

import { useState, useEffect, useRef } from "react";

interface Workspace {
  id: string;
  type: "personal" | "company";
  name: string;
  companyId: string | null;
  companyName: string | null;
  memberRole: string | null;
}

export function CompanySwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((data: { workspaces?: Workspace[] }) => {
        const items = Array.isArray(data.workspaces) ? data.workspaces : [];
        setWorkspaces(items);
        const cookie = document.cookie
          .split("; ")
          .find((c) => c.startsWith("active_workspace="));
        const cookieId = cookie?.split("=")[1];
        if (cookieId && items.some((workspace) => workspace.id === cookieId)) {
          setActiveId(cookieId);
        } else if (items.length > 0) {
          switchWorkspace(items.find((workspace) => workspace.type === "personal")?.id || items[0].id, items);
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

  if (workspaces.length === 0) return null;

  const active = workspaces.find((workspace) => workspace.id === activeId);

  function switchWorkspace(id: string, items: Workspace[] = workspaces) {
    const workspace = items.find((entry) => entry.id === id);
    if (!workspace) return;

    setActiveId(id);
    document.cookie = `active_workspace=${id};path=/;max-age=${60 * 60 * 24 * 365}`;
    if (workspace.companyId) {
      document.cookie = `active_company=${workspace.companyId};path=/;max-age=${60 * 60 * 24 * 365}`;
    } else {
      document.cookie = "active_company=; path=/; max-age=0";
    }
    setOpen(false);
    window.location.reload();
  }

  const title = active?.type === "company"
    ? active.companyName || active.name
    : "Personal";
  const subtitle = active?.type === "company"
    ? active.memberRole?.toUpperCase() || "COMPANY"
    : "PRIVATE WORKSPACE";

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-soft)] font-mono text-[10px] font-bold text-[var(--accent)]">
          {active?.type === "personal" ? "P" : active?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] tracking-wider text-[var(--text-primary)]">
            {title}
          </p>
          <p className="truncate text-[8px] tracking-wider text-[var(--text-tertiary)]">
            {subtitle}
          </p>
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
          {workspaces.map((workspace) => {
            const label = workspace.type === "company"
              ? workspace.companyName || workspace.name
              : "Personal";
            const meta = workspace.type === "company"
              ? workspace.memberRole?.toUpperCase() || "COMPANY"
              : "PRIVATE WORKSPACE";
            return (
              <button
                key={workspace.id}
                onClick={() => switchWorkspace(workspace.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)] ${
                  workspace.id === activeId ? "bg-neo/5" : ""
                }`}
              >
                <div className="flex h-5 w-5 items-center justify-center rounded bg-neo/15 font-mono text-[9px] font-bold text-[var(--accent)]">
                  {workspace.type === "personal" ? "P" : label[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] tracking-wider text-[var(--text-primary)]">
                    {label}
                  </p>
                  <p className="truncate text-[8px] tracking-wider text-[var(--text-tertiary)]">
                    {meta}
                  </p>
                </div>
                {workspace.id === activeId && (
                  <div
                    className="h-1.5 w-1.5 rounded-full bg-neo"
                    style={{ boxShadow: "0 0 6px rgba(0, 240, 255, 0.6)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
