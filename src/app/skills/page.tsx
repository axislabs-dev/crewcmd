"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  version: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  installed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  source: string;
  version: string;
  sourceUrl: string;
}

interface AgentSkillRow {
  id: string;
  agentId: string;
  skillId: string;
  enabled: boolean;
  skill: { name: string; slug: string } | null;
}

interface Agent {
  id: string;
  callsign: string;
  name: string;
  emoji: string;
}

// ─── Source Badge ────────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { label: string; icon: string; color: string; border: string; bg: string }> = {
  clawhub: { label: "ClawHub", icon: "\u{1F43E}", color: "text-[#00f0ff]", border: "border-[#00f0ff]/30", bg: "bg-[#00f0ff]/10" },
  skills_sh: { label: "skills.sh", icon: "\u25B2", color: "text-[var(--text-primary)]", border: "border-[var(--border-medium)]", bg: "bg-[var(--bg-surface-hover)]" },
  github: { label: "GitHub", icon: "\u2B24", color: "text-[#8b949e]", border: "border-[#8b949e]/30", bg: "bg-[#8b949e]/10" },
  custom: { label: "Custom", icon: "\u270F\uFE0F", color: "text-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/10" },
};

function SourceBadge({ source }: { source: string }) {
  const style = SOURCE_STYLES[source] || SOURCE_STYLES.custom;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wider border ${style.color} ${style.border} ${style.bg}`}
    >
      <span className="text-[9px]">{style.icon}</span>
      {style.label.toUpperCase()}
    </span>
  );
}

// ─── Styling Constants ──────────────────────────────────────────────────

const inputClass =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#00f0ff]/40 transition-colors";

// ─── Main Page ──────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceSkill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedMarketplace, setSelectedMarketplace] = useState<MarketplaceSkill | null>(null);
  const [tab, setTab] = useState<"installed" | "browse" | "custom">("installed");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [installing, setInstalling] = useState<string | null>(null);

  // Custom skill form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customContent, setCustomContent] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);

  // Edit mode for selected custom skill
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Agent skills for detail view
  const [skillAgents, setSkillAgents] = useState<{ callsign: string; name: string; emoji: string }[]>([]);

  const fetchSkills = useCallback(async (cId: string) => {
    try {
      const res = await fetch(`/api/skills?company_id=${cId}`);
      if (res.ok) {
        setSkills(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchMarketplace = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/browse");
      if (res.ok) {
        setMarketplace(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("active_company="));
    const cId = cookie?.split("=")[1] ?? null;
    setCompanyId(cId);

    const init = async () => {
      if (cId) await fetchSkills(cId);
      await Promise.all([fetchMarketplace(), fetchAgents()]);
      setLoading(false);
    };
    init();
  }, [fetchSkills, fetchMarketplace, fetchAgents]);

  // Find which agents use a skill
  const findAgentsForSkill = useCallback(async (skillId: string) => {
    const matched: { callsign: string; name: string; emoji: string }[] = [];
    for (const agent of agents) {
      try {
        const res = await fetch(`/api/agents/${agent.callsign}/skills`);
        if (res.ok) {
          const rows: AgentSkillRow[] = await res.json();
          if (rows.some((r) => r.skillId === skillId)) {
            matched.push({ callsign: agent.callsign, name: agent.name, emoji: agent.emoji || "\u{1F916}" });
          }
        }
      } catch {
        // ignore
      }
    }
    setSkillAgents(matched);
  }, [agents]);

  function selectSkill(skill: Skill) {
    setSelectedSkill(skill);
    setSelectedMarketplace(null);
    setEditing(false);
    setSkillAgents([]);
    findAgentsForSkill(skill.id);
  }

  function selectMarketplaceSkill(ms: MarketplaceSkill) {
    setSelectedMarketplace(ms);
    setSelectedSkill(null);
    setEditing(false);
    setSkillAgents([]);
  }

  async function handleInstall(ms: MarketplaceSkill) {
    if (!companyId) return;
    setInstalling(ms.slug);
    try {
      const res = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: ms.source,
          name: ms.name,
          slug: ms.slug,
          description: ms.description,
          version: ms.version,
          sourceUrl: ms.sourceUrl,
          companyId,
        }),
      });
      if (res.ok) {
        await fetchSkills(companyId);
      }
    } catch {
      // ignore
    } finally {
      setInstalling(null);
    }
  }

  async function handleCreateCustom() {
    if (!companyId || !customName.trim()) return;
    setSavingCustom(true);
    try {
      const slug = customName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName,
          slug,
          description: customDescription || null,
          content: customContent || null,
          source: "custom",
          companyId,
        }),
      });
      if (res.ok) {
        setShowCustomForm(false);
        setCustomName("");
        setCustomDescription("");
        setCustomContent("");
        await fetchSkills(companyId);
      }
    } catch {
      // ignore
    } finally {
      setSavingCustom(false);
    }
  }

  async function handleSaveEdit() {
    if (!selectedSkill) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/skills/${selectedSkill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          content: editContent || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedSkill(updated);
        setEditing(false);
        if (companyId) await fetchSkills(companyId);
      }
    } catch {
      // ignore
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteSkill(skillId: string) {
    try {
      await fetch(`/api/skills/${skillId}`, { method: "DELETE" });
      setSelectedSkill(null);
      if (companyId) await fetchSkills(companyId);
    } catch {
      // ignore
    }
  }

  function startEditing(skill: Skill) {
    setEditing(true);
    setEditName(skill.name);
    setEditDescription(skill.description || "");
    setEditContent(skill.content || "");
  }

  // ── Filter logic ──

  const installedSlugs = new Set(skills.map((s) => s.slug));

  const filteredInstalled = skills.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.slug.includes(search.toLowerCase())
  );

  const filteredMarketplace = marketplace.filter((ms) => {
    if (sourceFilter !== "all" && ms.source !== sourceFilter) return false;
    if (search && !ms.name.toLowerCase().includes(search.toLowerCase()) && !ms.slug.includes(search.toLowerCase())) return false;
    return true;
  });

  const customSkills = skills.filter((s) => s.source === "custom");
  const filteredCustom = customSkills.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.slug.includes(search.toLowerCase())
  );

  // ── Count agents per skill ──
  // We don't have this preloaded, so we'll show it in the detail view only

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--text-tertiary)]">No company selected</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">Select a company from the sidebar to manage skills.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] lg:h-screen">
      {/* ── Left Panel: Skills Library ── */}
      <div className="flex w-full flex-col border-r border-[var(--border-subtle)] lg:w-[420px] lg:flex-shrink-0">
        {/* Header */}
        <div className="border-b border-[var(--border-subtle)] px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="font-mono text-lg font-bold tracking-wider text-[var(--accent)]">SKILLS</h1>
            <span className="text-[11px] text-[var(--text-tertiary)]">{skills.length} INSTALLED</span>
          </div>
          <div className="mt-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className={inputClass}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-[var(--border-subtle)]">
          {(["installed", "browse", "custom"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-[11px] tracking-wider transition-colors ${
                tab === t
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {/* INSTALLED TAB */}
          {tab === "installed" && (
            <>
              {filteredInstalled.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-medium)] py-10 text-center">
                  <p className="text-xs text-[var(--text-tertiary)]">No skills installed</p>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Browse the marketplace to install skills.
                  </p>
                  <button
                    onClick={() => setTab("browse")}
                    className="mt-3 rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-[11px] tracking-wider text-[var(--accent)] border border-[var(--accent-medium)] transition-colors hover:bg-[var(--accent-soft)]"
                  >
                    BROWSE MARKETPLACE
                  </button>
                </div>
              ) : (
                filteredInstalled.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => selectSkill(skill)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedSkill?.id === skill.id
                        ? "border-[var(--accent-medium)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-[var(--text-primary)]">{skill.name}</span>
                      <SourceBadge source={skill.source} />
                    </div>
                    {skill.description && (
                      <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)] line-clamp-1">{skill.description}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      {skill.version && (
                        <span className="font-mono text-[9px] text-[var(--text-tertiary)]">v{skill.version}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </>
          )}

          {/* BROWSE TAB */}
          {tab === "browse" && (
            <>
              {/* Source filter */}
              <div className="flex gap-1.5 pb-1">
                {[
                  { value: "all", label: "All" },
                  { value: "clawhub", label: "ClawHub" },
                  { value: "skills_sh", label: "skills.sh" },
                  { value: "github", label: "GitHub" },
                ].map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setSourceFilter(f.value)}
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider transition-colors border ${
                      sourceFilter === f.value
                        ? "border-[var(--accent-medium)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {f.label.toUpperCase()}
                  </button>
                ))}
              </div>

              {filteredMarketplace.map((ms) => {
                const isInstalled = installedSlugs.has(ms.slug);
                return (
                  <button
                    key={`${ms.source}-${ms.slug}`}
                    onClick={() => selectMarketplaceSkill(ms)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedMarketplace?.slug === ms.slug && selectedMarketplace?.source === ms.source
                        ? "border-[var(--accent-medium)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-[var(--text-primary)]">{ms.name}</span>
                      <div className="flex items-center gap-2">
                        <SourceBadge source={ms.source} />
                        {isInstalled ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-emerald-400">
                            INSTALLED
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInstall(ms);
                            }}
                            disabled={installing === ms.slug}
                            className="rounded-full border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[9px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                          >
                            {installing === ms.slug ? "..." : "INSTALL"}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)] line-clamp-2">{ms.description}</p>
                    <span className="mt-1 inline-block font-mono text-[9px] text-[var(--text-tertiary)]">v{ms.version}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* CUSTOM TAB */}
          {tab === "custom" && (
            <>
              <button
                onClick={() => setShowCustomForm(true)}
                className="w-full rounded-lg border border-dashed border-[var(--accent-medium)] bg-[var(--accent-soft)] py-3 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
              >
                + NEW SKILL
              </button>

              {filteredCustom.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => selectSkill(skill)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedSkill?.id === skill.id
                      ? "border-[var(--accent-medium)] bg-[var(--accent-soft)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-[var(--text-primary)]">{skill.name}</span>
                    <SourceBadge source="custom" />
                  </div>
                  {skill.description && (
                    <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)] line-clamp-1">{skill.description}</p>
                  )}
                </button>
              ))}

              {filteredCustom.length === 0 && !showCustomForm && (
                <div className="py-6 text-center">
                  <p className="font-mono text-[10px] text-[var(--text-tertiary)]">No custom skills yet.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right Panel: Detail / Form ── */}
      <div className="hidden flex-1 overflow-y-auto lg:block">
        {/* Custom skill creation form */}
        {showCustomForm && (
          <div className="mx-auto max-w-2xl p-6">
            <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--accent)]">NEW CUSTOM SKILL</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">NAME</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g., My Custom Skill"
                  className={`mt-1 ${inputClass}`}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">DESCRIPTION</label>
                <input
                  type="text"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="What does this skill do?"
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">SKILL.MD CONTENT</label>
                <textarea
                  value={customContent}
                  onChange={(e) => setCustomContent(e.target.value)}
                  rows={12}
                  placeholder={"# My Skill\n\nDescribe the skill capabilities, tools, and instructions..."}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowCustomForm(false)}
                  className="rounded-lg border border-[var(--border-medium)] px-4 py-2 font-mono text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleCreateCustom}
                  disabled={savingCustom || !customName.trim()}
                  className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
                >
                  {savingCustom ? "SAVING..." : "CREATE SKILL"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Installed skill detail */}
        {selectedSkill && !showCustomForm && (
          <div className="mx-auto max-w-2xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--text-primary)]">{selectedSkill.name}</h2>
                  <SourceBadge source={selectedSkill.source} />
                </div>
                {selectedSkill.version && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)]">v{selectedSkill.version}</p>
                )}
                {selectedSkill.description && (
                  <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{selectedSkill.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedSkill.source === "custom" && !editing && (
                  <button
                    onClick={() => startEditing(selectedSkill)}
                    className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]"
                  >
                    EDIT
                  </button>
                )}
                {selectedSkill.source !== "custom" && (
                  <button className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-secondary)]">
                    CHECK FOR UPDATES
                  </button>
                )}
                <button
                  onClick={() => handleDeleteSkill(selectedSkill.id)}
                  className="rounded-lg border border-red-500/20 px-3 py-1.5 font-mono text-[10px] tracking-wider text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  REMOVE
                </button>
              </div>
            </div>

            {selectedSkill.sourceUrl && (
              <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
                Source: {selectedSkill.sourceUrl}
              </p>
            )}

            {/* Edit mode */}
            {editing && (
              <div className="mt-4 space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div>
                  <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">NAME</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">DESCRIPTION</label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">CONTENT</label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={14}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-[var(--border-medium)] px-4 py-2 font-mono text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
                  >
                    {savingEdit ? "SAVING..." : "SAVE"}
                  </button>
                </div>
              </div>
            )}

            {/* Content display */}
            {!editing && selectedSkill.content && (
              <div className="mt-4">
                <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">SKILL.MD</label>
                <pre className="mt-2 max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 font-mono text-xs text-[var(--text-secondary)]">
                  {selectedSkill.content}
                </pre>
              </div>
            )}

            {/* Agents using this skill */}
            <div className="mt-6">
              <label className="text-[11px] tracking-wider text-[var(--text-secondary)] uppercase">
                AGENTS USING THIS SKILL
              </label>
              {skillAgents.length === 0 ? (
                <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">No agents have this skill attached.</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {skillAgents.map((a) => (
                    <div key={a.callsign} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                      <span className="text-sm">{a.emoji}</span>
                      <span className="font-mono text-xs text-[var(--text-primary)]">{a.name}</span>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{a.callsign}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Marketplace skill detail */}
        {selectedMarketplace && !showCustomForm && !selectedSkill && (
          <div className="mx-auto max-w-2xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-mono text-sm font-bold tracking-wider text-[var(--text-primary)]">{selectedMarketplace.name}</h2>
                  <SourceBadge source={selectedMarketplace.source} />
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)]">v{selectedMarketplace.version}</p>
                <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{selectedMarketplace.description}</p>
              </div>
              <div>
                {installedSlugs.has(selectedMarketplace.slug) ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] tracking-wider text-emerald-400">
                    INSTALLED
                  </span>
                ) : (
                  <button
                    onClick={() => handleInstall(selectedMarketplace)}
                    disabled={installing === selectedMarketplace.slug}
                    className="rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-4 py-2 text-[11px] tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                  >
                    {installing === selectedMarketplace.slug ? "INSTALLING..." : "INSTALL SKILL"}
                  </button>
                )}
              </div>
            </div>

            <p className="mt-3 font-mono text-[10px] text-[var(--text-tertiary)]">
              Source: {selectedMarketplace.sourceUrl}
            </p>

            <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="font-mono text-[10px] text-[var(--text-tertiary)]">
                Skill content will be fetched from the marketplace when real API integration is available.
                For now, installing creates a skill record that can be attached to agents.
              </p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!selectedSkill && !selectedMarketplace && !showCustomForm && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <svg className="h-6 w-6 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
                </svg>
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">Select a skill to view details</p>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">Or browse the marketplace to discover new skills.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
