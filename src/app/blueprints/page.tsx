"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { BlueprintTemplate, BlueprintAgentTemplate } from "@/db/schema";

// ─── Types ──────────────────────────────────────────────────────────

interface Blueprint {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  agentCount: number;
  isBuiltIn: boolean;
  companyId: string | null;
  template: BlueprintTemplate;
  popularity: number;
  createdAt: string | null;
  updatedAt: string | null;
}

type Category = "all" | "development" | "marketing" | "support" | "operations" | "creative" | "founder";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "development", label: "DEVELOPMENT" },
  { key: "marketing", label: "MARKETING" },
  { key: "support", label: "SUPPORT" },
  { key: "operations", label: "OPERATIONS" },
  { key: "creative", label: "CREATIVE" },
  { key: "founder", label: "FOUNDER" },
];

// ─── Helpers ────────────────────────────────────────────────────────

function getCompanyId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_company=([^;]*)/);
  return match ? match[1] : null;
}

/** Maps adapter type slugs to readable labels */
function adapterLabel(t: string): string {
  const map: Record<string, string> = {
    claude_local: "Claude Code",
    codex_local: "Codex",
    cursor: "Cursor",
    opencode_local: "OpenCode",
    openrouter: "OpenRouter",
    openclaw_gateway: "OpenClaw",
    http: "HTTP",
    process: "Process",
    gemini_local: "Gemini",
    pi_local: "Pi",
  };
  return map[t] ?? t;
}

// ─── Page ───────────────────────────────────────────────────────────

export default function BlueprintsPage() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>("all");
  const [selected, setSelected] = useState<Blueprint | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ count: number } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [customAgents, setCustomAgents] = useState<Partial<BlueprintAgentTemplate>[]>([]);

  const fetchBlueprints = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      const companyId = getCompanyId();
      if (companyId) params.set("company_id", companyId);
      const res = await fetch(`/api/blueprints?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBlueprints(data.blueprints ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchBlueprints();
  }, [fetchBlueprints]);

  // When a blueprint is selected, init customization state
  useEffect(() => {
    if (selected) {
      setCustomAgents(selected.template.agents.map(() => ({})));
      setDeployResult(null);
      setDeployError(null);
      setShowCustomize(false);
    }
  }, [selected]);

  /** Deploy a blueprint to the active company */
  const handleDeploy = async (blueprint: Blueprint) => {
    const companyId = getCompanyId();
    if (!companyId) {
      setDeployError("No active company selected. Switch to a company first.");
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      const hasCustomizations = customAgents.some((a) => Object.keys(a).length > 0);
      const res = await fetch("/api/blueprints/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: blueprint.id,
          companyId,
          ...(hasCustomizations ? { customize: { agents: customAgents } } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setDeployResult({ count: data.count });
      } else {
        const data = await res.json();
        setDeployError(data.error ?? "Deploy failed");
      }
    } catch {
      setDeployError("Network error. Please try again.");
    } finally {
      setDeploying(false);
    }
  };

  const updateCustomAgent = (idx: number, field: string, value: string) => {
    setCustomAgents((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] px-6 py-6">
        <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
          TEAM BLUEPRINTS
        </h1>
        <p className="mt-1 text-[11px] tracking-wider text-[var(--text-tertiary)]">
          DEPLOY A FULL AGENT TEAM IN ONE CLICK
        </p>
      </div>

      {/* Category filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--border-subtle)] px-6 py-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11px] tracking-wider transition-all ${
              category === cat.key
                ? "bg-neo/15 text-[var(--accent)]"
                : "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
            }`}
            style={category === cat.key ? { boxShadow: "inset 0 0 12px rgba(0, 240, 255, 0.08)" } : undefined}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
          </div>
        ) : blueprints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-[var(--text-tertiary)]">NO BLUEPRINTS FOUND</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Try a different category filter
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {blueprints.map((bp) => (
              <button
                key={bp.id}
                onClick={() => setSelected(bp)}
                className="group relative flex flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-left transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)]"
              >
                {/* Icon + name */}
                <div className="flex items-start gap-3">
                  <span className="text-3xl leading-none">{bp.icon}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono text-sm font-bold tracking-wider text-[var(--text-primary)] group-hover:text-[var(--text-primary)]">
                      {bp.name.toUpperCase()}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      {bp.description}
                    </p>
                  </div>
                </div>

                {/* Badges */}
                <div className="mt-4 flex items-center gap-2">
                  <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[var(--accent)]">
                    {bp.agentCount} AGENTS
                  </span>
                  <span className="rounded-md bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
                    {bp.category.toUpperCase()}
                  </span>
                  {bp.popularity > 0 && (
                    <span className="rounded-md bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
                      DEPLOYED {bp.popularity}x
                    </span>
                  )}
                </div>

                {/* Deploy CTA */}
                <div className="mt-4 flex items-center justify-end">
                  <span className="rounded-lg bg-neo/15 px-3 py-1.5 text-[11px] font-bold tracking-wider text-[var(--accent)] opacity-0 transition-all group-hover:opacity-100"
                    style={{ boxShadow: "0 0 12px rgba(0, 240, 255, 0.1)" }}
                  >
                    ► DEPLOY
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="relative mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-6 py-5">
              <span className="text-4xl">{selected.icon}</span>
              <div className="flex-1">
                <h2 className="font-mono text-base font-bold tracking-[0.12em] text-[var(--text-primary)]">
                  {selected.name.toUpperCase()}
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[var(--accent)]">
                    {selected.agentCount} AGENTS
                  </span>
                  <span className="rounded-md bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
                    {selected.category.toUpperCase()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Success state */}
              {deployResult && (
                <div className="mb-5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                  <p className="font-mono text-[12px] font-bold tracking-wider text-emerald-400">
                    DEPLOYED SUCCESSFULLY
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-emerald-400/70">
                    {deployResult.count} agents created.{" "}
                    <Link href="/agents" className="underline hover:text-emerald-300">
                      View agents →
                    </Link>
                  </p>
                </div>
              )}

              {/* Error state */}
              {deployError && (
                <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                  <p className="font-mono text-[12px] font-bold tracking-wider text-red-400">
                    DEPLOY FAILED
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-red-400/70">{deployError}</p>
                </div>
              )}

              {/* Description */}
              <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {selected.template.description}
              </p>

              {/* Use cases */}
              <div className="mt-5">
                <h3 className="text-[11px] font-bold tracking-[0.15em] text-[var(--text-tertiary)]">
                  USE CASES
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {selected.template.useCases.map((uc, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neo/50" />
                      <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">{uc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Agent roster */}
              <div className="mt-6">
                <h3 className="text-[11px] font-bold tracking-[0.15em] text-[var(--text-tertiary)]">
                  AGENT ROSTER
                </h3>
                <div className="mt-3 space-y-2">
                  {selected.template.agents.map((agent) => (
                    <div
                      key={agent.callsign}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
                    >
                      <span className="text-xl">{agent.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono text-[12px] font-bold tracking-wider"
                            style={{ color: agent.color }}
                          >
                            {agent.callsign}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-secondary)]">{agent.name}</span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">
                          {agent.title} · {adapterLabel(agent.adapterType)}
                          {agent.reportsTo && <span> · reports to {agent.reportsTo}</span>}
                        </p>
                      </div>
                      <span className="rounded bg-[var(--bg-surface-hover)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[var(--text-tertiary)]">
                        {agent.role.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hierarchy tree */}
              <div className="mt-6">
                <h3 className="text-[11px] font-bold tracking-[0.15em] text-[var(--text-tertiary)]">
                  HIERARCHY
                </h3>
                <div className="mt-3 space-y-2">
                  {selected.template.hierarchy.map((node) => {
                    const parent = selected.template.agents.find(
                      (a) => a.callsign.toUpperCase() === node.callsign.toUpperCase()
                    );
                    return (
                      <div key={node.callsign} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{parent?.emoji ?? "👤"}</span>
                          <span
                            className="font-mono text-[11px] font-bold tracking-wider"
                            style={{ color: parent?.color ?? "#fff" }}
                          >
                            {node.callsign}
                          </span>
                        </div>
                        {node.children.length > 0 && (
                          <div className="mt-2 ml-5 flex flex-wrap gap-1.5">
                            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">→</span>
                            {node.children.map((child) => {
                              const childAgent = selected.template.agents.find(
                                (a) => a.callsign.toUpperCase() === child.toUpperCase()
                              );
                              return (
                                <span
                                  key={child}
                                  className="rounded bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[10px] tracking-wider"
                                  style={{ color: childAgent?.color ?? "#fff" }}
                                >
                                  {childAgent?.emoji} {child}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customize before deploy */}
              <div className="mt-6">
                <button
                  onClick={() => setShowCustomize(!showCustomize)}
                  className="flex items-center gap-2 text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  <svg
                    className={`h-3 w-3 transition-transform ${showCustomize ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  CUSTOMIZE BEFORE DEPLOY
                </button>
                {showCustomize && (
                  <div className="mt-3 space-y-3">
                    {selected.template.agents.map((agent, idx) => (
                      <div
                        key={agent.callsign}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span>{agent.emoji}</span>
                          <span className="font-mono text-[11px] font-bold tracking-wider text-[var(--text-secondary)]">
                            {agent.callsign}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)] mb-1">
                              NAME
                            </label>
                            <input
                              type="text"
                              placeholder={agent.name}
                              value={customAgents[idx]?.name ?? ""}
                              onChange={(e) => updateCustomAgent(idx, "name", e.target.value)}
                              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/30 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)] mb-1">
                              CALLSIGN
                            </label>
                            <input
                              type="text"
                              placeholder={agent.callsign}
                              value={customAgents[idx]?.callsign ?? ""}
                              onChange={(e) => updateCustomAgent(idx, "callsign", e.target.value)}
                              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/30 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)] mb-1">
                              ROLE
                            </label>
                            <input
                              type="text"
                              placeholder={agent.role}
                              value={customAgents[idx]?.role ?? ""}
                              onChange={(e) => updateCustomAgent(idx, "role", e.target.value)}
                              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/30 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)] mb-1">
                              ADAPTER
                            </label>
                            <input
                              type="text"
                              placeholder={adapterLabel(agent.adapterType)}
                              value={customAgents[idx]?.adapterType ?? ""}
                              onChange={(e) => updateCustomAgent(idx, "adapterType", e.target.value)}
                              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/30 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-6 py-4">
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg px-4 py-2 text-[11px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
              >
                CANCEL
              </button>
              {deployResult ? (
                <Link
                  href="/agents"
                  className="rounded-lg bg-[var(--accent-soft)] px-5 py-2 text-[11px] font-bold tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-medium)]"
                  style={{ boxShadow: "0 0 16px rgba(0, 240, 255, 0.15)" }}
                >
                  VIEW AGENTS →
                </Link>
              ) : (
                <button
                  onClick={() => handleDeploy(selected)}
                  disabled={deploying}
                  className="rounded-lg bg-[var(--accent-soft)] px-5 py-2 text-[11px] font-bold tracking-wider text-[var(--accent)] transition-all hover:bg-[var(--accent-medium)] disabled:opacity-50"
                  style={{ boxShadow: "0 0 16px rgba(0, 240, 255, 0.15)" }}
                >
                  {deploying ? (
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border border-neo/30 border-t-neo" />
                      DEPLOYING...
                    </span>
                  ) : (
                    "► DEPLOY TO COMPANY"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
