"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentVisibility, AgentAccessGrant } from "@/db/schema-access";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentSummary {
  id: string;
  callsign: string;
  name: string;
  emoji: string;
  role: string;
  visibility?: AgentVisibility;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface GrantRow extends AgentAccessGrant {
  userName?: string;
  userEmail?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCompanyId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_company=([^;]*)/);
  return match ? match[1] : null;
}

const VISIBILITY_META: Record<AgentVisibility, { label: string; icon: string; desc: string; color: string; borderActive: string; bgActive: string }> = {
  private: {
    label: "PRIVATE",
    icon: "🔒",
    desc: "Only you",
    color: "amber",
    borderActive: "border-amber-500/60",
    bgActive: "bg-amber-500/10",
  },
  assigned: {
    label: "ASSIGNED",
    icon: "👥",
    desc: "Selected members",
    color: "blue",
    borderActive: "border-blue-500/60",
    bgActive: "bg-blue-500/10",
  },
  team: {
    label: "TEAM",
    icon: "🌐",
    desc: "Everyone in company",
    color: "green",
    borderActive: "border-green-500/60",
    bgActive: "bg-green-500/10",
  },
};

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-[#00f0ff]" : "bg-[var(--bg-tertiary)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// ─── Visibility Badge ─────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: AgentVisibility }) {
  const colorMap: Record<AgentVisibility, string> = {
    private: "text-amber-400 border-amber-400/40 bg-amber-400/10",
    assigned: "text-blue-400 border-blue-400/40 bg-blue-400/10",
    team: "text-green-400 border-green-400/40 bg-green-400/10",
  };
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase ${colorMap[visibility]}`}>
      {visibility}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentAccessPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch agents + members ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const companyId = getCompanyId();
      const [agentsRes, membersRes] = await Promise.all([
        fetch("/api/agents"),
        companyId ? fetch(`/api/companies/${companyId}/members`) : Promise.resolve(null),
      ]);

      if (agentsRes.ok) {
        const data = await agentsRes.json();
        const list: AgentSummary[] = (data.agents || []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          callsign: a.callsign as string,
          name: a.name as string,
          emoji: a.emoji as string,
          role: (a.role as string) ?? "engineer",
          visibility: (a.visibility as AgentVisibility) ?? "team",
        }));
        setAgents(list);
      }

      if (membersRes?.ok) {
        const mData = await membersRes.json();
        setMembers(Array.isArray(mData) ? mData : mData.members ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Fetch grants for selected agent ─────────────────────────────────────

  const fetchGrants = useCallback(async (agentId: string) => {
    const companyId = getCompanyId();
    if (!companyId) return;
    try {
      const res = await fetch(`/api/agents/access?company_id=${companyId}&agent_id=${agentId}`);
      if (res.ok) {
        const data = await res.json();
        setGrants(Array.isArray(data) ? data : []);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      fetchGrants(selectedAgent.id);
    } else {
      setGrants([]);
    }
  }, [selectedAgent, fetchGrants]);

  // ── Visibility change ───────────────────────────────────────────────────

  const changeVisibility = async (tier: AgentVisibility) => {
    if (!selectedAgent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${selectedAgent.callsign}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: tier }),
      });
      if (res.ok) {
        const updated = { ...selectedAgent, visibility: tier };
        setSelectedAgent(updated);
        setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      }
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle a permission for a grant ─────────────────────────────────────

  const togglePermission = async (grantId: string, field: "canInteract" | "canConfigure" | "canViewLogs", value: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/access/${grantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setGrants((prev) =>
          prev.map((g) => (g.id === grantId ? { ...g, [field]: value } : g))
        );
      }
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  // ── Grant access to a new member ────────────────────────────────────────

  const grantAccess = async (userId: string) => {
    if (!selectedAgent) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agents/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          userId,
          grantedBy: "dashboard",
        }),
      });
      if (res.ok) {
        await fetchGrants(selectedAgent.id);
      }
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  // ── Revoke access ──────────────────────────────────────────────────────

  const revokeAccess = async (grantId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/access/${grantId}`, { method: "DELETE" });
      if (res.ok) {
        setGrants((prev) => prev.filter((g) => g.id !== grantId));
      }
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  // ── Bulk actions ────────────────────────────────────────────────────────

  const grantAll = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    const ungrantedMembers = members.filter(
      (m) => !grants.some((g) => g.userId === m.id)
    );
    for (const m of ungrantedMembers) {
      await grantAccess(m.id);
    }
    setSaving(false);
  };

  const revokeAll = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    for (const g of grants) {
      await revokeAccess(g.id);
    }
    setSaving(false);
  };

  // ── Which members don't have a grant yet ────────────────────────────────

  const ungrantedMembers = members.filter(
    (m) => !grants.some((g) => g.userId === m.id)
  );

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-[11px] tracking-wider text-[var(--text-tertiary)] animate-pulse">
          LOADING ACCESS DATA...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="font-mono text-[12px] text-red-400">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-[11px] tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-bold tracking-[0.15em] text-[var(--text-primary)]">
            AGENT ACCESS CONTROL
          </h1>
          <p className="text-[11px] tracking-wider text-[var(--text-tertiary)]">
            Manage who can see and interact with your agents
          </p>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ── Agent List (Left Column) ─────────────────────────────── */}
          <div className="w-full space-y-2 lg:w-[320px] lg:shrink-0">
            <p className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">
              Select Agent
            </p>
            {agents.length === 0 ? (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center">
                <p className="text-[11px] text-[var(--text-tertiary)]">No agents found</p>
              </div>
            ) : (
              agents.map((agent) => {
                const isSelected = selectedAgent?.id === agent.id;
                const vis = agent.visibility ?? "team";
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(isSelected ? null : agent)}
                    className={`w-full rounded-lg border-2 p-3 text-left transition-all ${
                      isSelected
                        ? "border-[#00f0ff]/40 bg-[#00f0ff]/5"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{agent.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] font-bold tracking-wider text-[var(--text-primary)] truncate">
                            {agent.callsign}
                          </span>
                          <VisibilityBadge visibility={vis} />
                        </div>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                          {agent.role}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* ── Access Panel (Right Side) ────────────────────────────── */}
          <div className="flex-1">
            {!selectedAgent ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <p className="text-[11px] tracking-wider text-[var(--text-tertiary)]">
                  SELECT AN AGENT TO MANAGE ACCESS
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Agent Header */}
                <div className="flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <span className="text-3xl">{selectedAgent.emoji}</span>
                  <div>
                    <h2 className="font-mono text-[14px] font-bold tracking-wider text-[var(--text-primary)]">
                      {selectedAgent.name}
                    </h2>
                    <p className="font-mono text-[11px] text-[var(--text-tertiary)]">
                      {selectedAgent.callsign} &middot; {selectedAgent.role}
                    </p>
                  </div>
                  <div className="ml-auto">
                    <VisibilityBadge visibility={selectedAgent.visibility ?? "team"} />
                  </div>
                </div>

                {/* Visibility Selector */}
                <div>
                  <p className="mb-3 text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">
                    Visibility Tier
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(Object.keys(VISIBILITY_META) as AgentVisibility[]).map((tier) => {
                      const meta = VISIBILITY_META[tier];
                      const isActive = (selectedAgent.visibility ?? "team") === tier;
                      return (
                        <button
                          key={tier}
                          onClick={() => changeVisibility(tier)}
                          disabled={saving}
                          className={`rounded-lg border-2 p-4 text-left transition-all cursor-pointer ${
                            isActive
                              ? `${meta.borderActive} ${meta.bgActive}`
                              : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]"
                          } ${saving ? "opacity-50" : ""}`}
                        >
                          <div className="mb-2 text-xl">{meta.icon}</div>
                          <p className="text-[12px] font-bold tracking-wider text-[var(--text-primary)]">
                            {meta.label}
                          </p>
                          <p className="text-[11px] text-[var(--text-tertiary)]">
                            {meta.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Context Messages */}
                {(selectedAgent.visibility ?? "team") === "team" && (
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                    <p className="font-mono text-[11px] text-green-400/80">
                      All team members have access. Switch to Assigned to manage individual permissions.
                    </p>
                  </div>
                )}

                {(selectedAgent.visibility ?? "team") === "private" && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="font-mono text-[11px] text-amber-400/80">
                      Only you can access this agent.
                    </p>
                  </div>
                )}

                {/* Member Access List (assigned visibility only) */}
                {(selectedAgent.visibility ?? "team") === "assigned" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">
                        Member Permissions
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={grantAll}
                          disabled={saving || ungrantedMembers.length === 0}
                          className="rounded border border-[#00f0ff]/30 bg-[#00f0ff]/5 px-3 py-1 text-[10px] tracking-wider text-[#00f0ff]/80 transition-colors hover:bg-[#00f0ff]/10 disabled:opacity-40"
                        >
                          GRANT ALL
                        </button>
                        <button
                          onClick={revokeAll}
                          disabled={saving || grants.length === 0}
                          className="rounded border border-red-500/30 bg-red-500/5 px-3 py-1 text-[10px] tracking-wider text-red-400/80 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                        >
                          REVOKE ALL
                        </button>
                      </div>
                    </div>

                    {/* Existing Grants */}
                    {grants.length === 0 ? (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center">
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          No members have been granted access yet
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {grants.map((grant) => {
                          const member = members.find((m) => m.id === grant.userId);
                          const displayName = member?.name ?? grant.userName ?? grant.userEmail ?? "Unknown";
                          const initial = displayName.charAt(0).toUpperCase();

                          return (
                            <div
                              key={grant.id}
                              className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                            >
                              {/* Avatar */}
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] font-mono text-[12px] font-bold text-[var(--text-secondary)]">
                                {initial}
                              </div>

                              {/* Name + Role */}
                              <div className="min-w-0 flex-1">
                                <p className="font-mono text-[12px] text-[var(--text-primary)] truncate">
                                  {displayName}
                                </p>
                                <p className="text-[10px] text-[var(--text-tertiary)] truncate">
                                  {member?.role ?? "member"}
                                </p>
                              </div>

                              {/* Permission Toggles */}
                              <div className="flex items-center gap-4">
                                <div className="flex flex-col items-center gap-1">
                                  <span className={`text-[11px] ${grant.canInteract ? "text-[#00f0ff]" : "text-[var(--text-tertiary)]"}`} title="Interact">
                                    💬
                                  </span>
                                  <Toggle
                                    on={grant.canInteract}
                                    onChange={(v) => togglePermission(grant.id, "canInteract", v)}
                                    disabled={saving}
                                  />
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                  <span className={`text-[11px] ${grant.canConfigure ? "text-[#00f0ff]" : "text-[var(--text-tertiary)]"}`} title="Configure">
                                    ⚙️
                                  </span>
                                  <Toggle
                                    on={grant.canConfigure}
                                    onChange={(v) => togglePermission(grant.id, "canConfigure", v)}
                                    disabled={saving}
                                  />
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                  <span className={`text-[11px] ${grant.canViewLogs ? "text-[#00f0ff]" : "text-[var(--text-tertiary)]"}`} title="View Logs">
                                    👁️
                                  </span>
                                  <Toggle
                                    on={grant.canViewLogs}
                                    onChange={(v) => togglePermission(grant.id, "canViewLogs", v)}
                                    disabled={saving}
                                  />
                                </div>
                              </div>

                              {/* Revoke */}
                              <button
                                onClick={() => revokeAccess(grant.id)}
                                disabled={saving}
                                className="ml-2 font-mono text-[10px] text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-40"
                                title="Revoke access"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add Member Section */}
                    {ungrantedMembers.length > 0 && (
                      <div>
                        <p className="mb-2 text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">
                          Add Member
                        </p>
                        <div className="space-y-1">
                          {ungrantedMembers.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => grantAccess(m.id)}
                              disabled={saving}
                              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-[var(--border-medium)] p-2.5 text-left transition-all hover:border-[#00f0ff]/30 hover:bg-[#00f0ff]/5 disabled:opacity-40"
                            >
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface-hover)] font-mono text-[11px] text-[var(--text-tertiary)]">
                                {(m.name ?? m.email).charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
                                  {m.name ?? m.email}
                                </p>
                              </div>
                              <span className="font-mono text-[10px] tracking-wider text-[#00f0ff]/50">
                                + ADD
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
