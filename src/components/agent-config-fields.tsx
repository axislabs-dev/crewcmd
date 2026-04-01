"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Constants ──────────────────────────────────────────────────────────

export const ADAPTER_TYPES = [
  { value: "claude_local", label: "Claude Code (Local)" },
  { value: "codex_local", label: "Codex (Local)" },
  { value: "gemini_local", label: "Gemini CLI (Local)" },
  { value: "opencode_local", label: "OpenCode (Local)" },
  { value: "cursor", label: "Cursor (Local)" },
  { value: "pi_local", label: "Pi (Local)" },
  { value: "openclaw_gateway", label: "OpenClaw Gateway" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "process", label: "Process" },
  { value: "http", label: "HTTP" },
];

export const ROLES = [
  // Leadership
  { value: "ceo", label: "CEO" },
  { value: "cto", label: "CTO" },
  { value: "cfo", label: "CFO" },
  { value: "coo", label: "COO" },
  { value: "cmo", label: "CMO" },
  { value: "vp", label: "VP" },
  { value: "manager", label: "Manager" },
  // Engineering
  { value: "engineer", label: "Engineer" },
  { value: "architect", label: "Architect" },
  { value: "devops", label: "DevOps" },
  { value: "qa", label: "QA" },
  // Creative & Content
  { value: "designer", label: "Designer" },
  { value: "writer", label: "Writer" },
  { value: "copywriter", label: "Copywriter" },
  { value: "content_strategist", label: "Content Strategist" },
  { value: "social_media", label: "Social Media" },
  // Business
  { value: "analyst", label: "Analyst" },
  { value: "researcher", label: "Researcher" },
  { value: "sales", label: "Sales" },
  { value: "support", label: "Support" },
  { value: "recruiter", label: "Recruiter" },
  { value: "legal", label: "Legal" },
  { value: "accountant", label: "Accountant" },
  // Operations
  { value: "ops", label: "Operations" },
  { value: "coordinator", label: "Coordinator" },
  { value: "assistant", label: "Assistant" },
  // Generic
  { value: "specialist", label: "Specialist" },
  { value: "custom", label: "Custom" },
];

export const LOCAL_ADAPTERS = ["claude_local", "codex_local", "gemini_local", "opencode_local", "cursor", "pi_local"];
export const GATEWAY_ADAPTERS = ["openclaw_gateway"];
export const HTTP_ADAPTERS = ["http"];
export const OPENROUTER_ADAPTERS = ["openrouter"];

export const PROVIDERS = [
  { value: "", label: "None (manual)" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "openrouter", label: "OpenRouter" },
];

// Maps adapter types to their default provider for auto-inference
export const ADAPTER_TO_PROVIDER: Record<string, string> = {
  claude_local: "anthropic",
  codex_local: "openai",
  gemini_local: "google",
  openrouter: "openrouter",
};

const MODEL_PLACEHOLDERS: Record<string, string> = {
  claude_local: "e.g. claude-sonnet-4-20250514",
  codex_local: "e.g. o4-mini",
  gemini_local: "e.g. gemini-2.5-pro",
  cursor: "e.g. claude-sonnet-4-20250514",
  openrouter: "e.g. anthropic/claude-sonnet-4-20250514",
  openclaw_gateway: "e.g. claude-sonnet-4-20250514",
  opencode_local: "e.g. claude-sonnet-4-20250514",
  pi_local: "e.g. claude-sonnet-4-20250514",
};

const COMMAND_PLACEHOLDERS: Record<string, string> = {
  claude_local: "claude",
  codex_local: "codex",
  gemini_local: "gemini",
  opencode_local: "opencode",
  cursor: "cursor",
  pi_local: "pi",
};

const THINKING_EFFORT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// ─── Types ──────────────────────────────────────────────────────────────

export interface AgentConfigValues {
  name: string;
  callsign: string;
  role: string;
  adapterType: string;
  provider: string;
  model: string;
  workspacePath: string;
  emoji: string;
  color: string;
  command: string;
  thinkingEffort: string;
  promptTemplate: string;
  instructionsFile: string;
  extraArgs: string;
  envVars: Record<string, string>;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  wakeOnDemand: boolean;
  cooldownSec: number;
  maxConcurrentRuns: number;
  timeoutSec: number;
  gracePeriodSec: number;
  reportsTo: string;
  gatewayUrl: string;
  gatewayToken: string;
  httpUrl: string;
  httpAuthHeader: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  skillIds: string[];
}

export interface CompanySkill {
  id: string;
  name: string;
  slug: string;
  source: string;
  description?: string;
  metadata?: {
    category?: string;
    runtime?: string;
    command?: string | null;
    icon?: string;
    compatibleProviders?: string[] | null;
  };
}

export function defaultAgentConfigValues(): AgentConfigValues {
  return {
    name: "",
    callsign: "",
    role: "engineer",
    adapterType: "claude_local",
    provider: "",
    model: "",
    workspacePath: "",
    emoji: "\u{1F916}",
    color: "#00f0ff",
    command: "",
    thinkingEffort: "",
    promptTemplate: "",
    instructionsFile: "",
    extraArgs: "",
    envVars: {},
    heartbeatEnabled: false,
    heartbeatIntervalSec: 300,
    wakeOnDemand: true,
    cooldownSec: 60,
    maxConcurrentRuns: 1,
    timeoutSec: 600,
    gracePeriodSec: 30,
    reportsTo: "",
    gatewayUrl: "",
    gatewayToken: "",
    httpUrl: "",
    httpAuthHeader: "",
    openrouterApiKey: "",
    openrouterBaseUrl: "",
    skillIds: [],
  };
}

export function nameToCallsign(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

interface AgentConfigFieldsProps {
  values: AgentConfigValues;
  onChange: (patch: Partial<AgentConfigValues>) => void;
  existingAgents?: { id: string; name: string; callsign: string }[];
  companySkills?: CompanySkill[];
  companyId?: string | null;
}

// ─── Styling ────────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#00f0ff]/40 transition-colors";
const labelClass = "text-[11px] tracking-wider text-[var(--text-secondary)] uppercase";
const sectionHeaderClass = "text-xs tracking-[0.15em] text-[var(--text-secondary)] uppercase";

// ─── Custom Dropdown ────────────────────────────────────────────────────

function Dropdown({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${inputClass} flex items-center justify-between text-left`}
      >
        <span className={selected ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
          {selected?.label ?? placeholder ?? "Select..."}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-[var(--border-medium)] bg-[#0d1117] py-1 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-surface-hover)] ${
                o.value === value ? "text-[#00f0ff]" : "text-[var(--text-primary)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Model Combo (dropdown + free text) ─────────────────────────────────

function ModelInput({
  value,
  adapterType,
  onChange,
}: {
  value: string;
  adapterType: string;
  onChange: (val: string) => void;
}) {
  const placeholder = MODEL_PLACEHOLDERS[adapterType] ?? "Model name";

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

// ─── Dynamic Model Selector (fetches from provider API) ────────────────

function DynamicModelSelector({
  value,
  provider,
  adapterType,
  companyId,
  onChange,
}: {
  value: string;
  provider: string;
  adapterType: string;
  companyId: string;
  onChange: (val: string) => void;
}) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!provider || !companyId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/providers/${provider}/models?companyId=${companyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setModels([]);
        } else {
          setModels(data.models ?? []);
        }
      })
      .catch(() => setError("Failed to fetch models"))
      .finally(() => setLoading(false));
  }, [provider, companyId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // If no models fetched (error or no API key), fall back to free text
  if (error || (!loading && models.length === 0)) {
    return (
      <div>
        <ModelInput value={value} adapterType={adapterType} onChange={onChange} />
        {error && (
          <p className="mt-1 text-[11px] text-amber-400/80">{error}</p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${inputClass} flex items-center gap-2 text-[var(--text-tertiary)]`}>
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent" />
        Loading models...
      </div>
    );
  }

  // For OpenRouter (many models), always show search
  const isLargeList = provider === "openrouter" || models.length > 50;
  const filtered = search
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase())
      )
    : models;

  const selectedModel = models.find((m) => m.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${inputClass} flex items-center justify-between text-left`}
      >
        <span className={value ? "text-[var(--text-primary)] truncate" : "text-[var(--text-tertiary)]"}>
          {selectedModel ? selectedModel.name : value || "Select model..."}
        </span>
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-[var(--border-medium)] bg-[#0d1117] shadow-xl">
          {/* Search input for large lists or always for combobox feel */}
          {(isLargeList || models.length > 10) && (
            <div className="border-b border-[var(--border-subtle)] p-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className={`${inputClass} text-xs`}
                autoFocus
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            {/* Free text option for OpenRouter */}
            {isLargeList && search && !filtered.find((m) => m.id === search) && (
              <button
                type="button"
                onClick={() => {
                  onChange(search);
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-amber-400 transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                Use &quot;{search}&quot; as custom model
              </button>
            )}
            {filtered.slice(0, 100).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-surface-hover)] ${
                  m.id === value ? "text-[#00f0ff]" : "text-[var(--text-primary)]"
                }`}
              >
                <span className="block truncate">{m.name}</span>
                {m.name !== m.id && (
                  <span className="block truncate text-[10px] text-[var(--text-tertiary)]">{m.id}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">No models found</div>
            )}
            {filtered.length > 100 && (
              <div className="px-3 py-2 text-[10px] text-[var(--text-tertiary)]">
                Showing first 100 of {filtered.length} — refine your search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
        checked ? "bg-[#00f0ff]/30" : "bg-[var(--bg-tertiary)]"
      }`}
    >
      <div
        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
          checked ? "left-[18px] bg-[#00f0ff]" : "left-0.5 bg-[var(--text-tertiary)]"
        }`}
      />
    </button>
  );
}

// ─── Collapsible Section ────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = false,
  collapsible = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex w-full items-center justify-between py-3 ${collapsible ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={sectionHeaderClass}>{title}</span>
        {collapsible && (
          <svg
            className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </button>
      {(open || !collapsible) && <div className="space-y-3 pb-4">{children}</div>}
    </div>
  );
}

// ─── Password Input ─────────────────────────────────────────────────────

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} pr-14`}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
      >
        {visible ? "HIDE" : "SHOW"}
      </button>
    </div>
  );
}

// ─── Env Var Editor ─────────────────────────────────────────────────────

function EnvVarEditor({
  envVars,
  onChange,
}: {
  envVars: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
}) {
  const entries = Object.entries(envVars);
  // Always show at least one empty row
  const rows = [...entries, ["", ""]];

  const updateRow = useCallback(
    (index: number, key: string, val: string) => {
      const next: Record<string, string> = {};
      const oldEntries = Object.entries(envVars);
      if (index < oldEntries.length) {
        // Editing existing row
        for (let i = 0; i < oldEntries.length; i++) {
          if (i === index) {
            if (key) next[key] = val;
          } else {
            next[oldEntries[i][0]] = oldEntries[i][1];
          }
        }
      } else {
        // Adding new row
        for (const [k, v] of oldEntries) next[k] = v;
        if (key) next[key] = val;
      }
      onChange(next);
    },
    [envVars, onChange]
  );

  const removeRow = useCallback(
    (index: number) => {
      const next: Record<string, string> = {};
      const oldEntries = Object.entries(envVars);
      for (let i = 0; i < oldEntries.length; i++) {
        if (i !== index) next[oldEntries[i][0]] = oldEntries[i][1];
      }
      onChange(next);
    },
    [envVars, onChange]
  );

  return (
    <div className="space-y-2">
      {rows.map(([key, val], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={key}
            onChange={(e) => updateRow(i, e.target.value, val)}
            placeholder="KEY"
            className={`${inputClass} w-2/5`}
          />
          <input
            type="text"
            value={val}
            onChange={(e) => updateRow(i, key, e.target.value)}
            placeholder="VALUE"
            className={`${inputClass} flex-1`}
          />
          {i < entries.length && (
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="flex-shrink-0 text-sm text-[var(--text-tertiary)] transition-colors hover:text-red-400"
            >
              &times;
            </button>
          )}
          {i >= entries.length && <div className="w-4 flex-shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ─── Number Input with suffix ───────────────────────────────────────────

function NumberInput({
  value,
  onChange,
  suffix,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min ?? 0}
        className={`${inputClass} w-24`}
      />
      {suffix && <span className="text-[11px] text-[var(--text-tertiary)]">{suffix}</span>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

const SKILL_SOURCE_STYLES: Record<string, { icon: string; color: string }> = {
  "built-in": { icon: "\u26A1", color: "text-[#00f0ff]" },
  clawhub: { icon: "\u{1F43E}", color: "text-[#00f0ff]" },
  skills_sh: { icon: "\u25B2", color: "text-[var(--text-primary)]" },
  github: { icon: "\u2B24", color: "text-[#8b949e]" },
  custom: { icon: "\u270F\uFE0F", color: "text-amber-400" },
};

// ─── Skills Grid (fetches from API, filters by provider) ───────────

function SkillsGrid({
  values,
  onChange,
  companyId,
  companySkills,
}: {
  values: AgentConfigValues;
  onChange: (patch: Partial<AgentConfigValues>) => void;
  companyId?: string | null;
  companySkills?: CompanySkill[];
}) {
  const [apiSkills, setApiSkills] = useState<CompanySkill[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/skills?company_id=${companyId}`)
      .then((r) => r.json())
      .then((data: CompanySkill[]) => {
        if (Array.isArray(data)) setApiSkills(data);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [companyId]);

  // Merge API skills with any passed-in company skills (dedup by id)
  const allSkills = (() => {
    const seen = new Set<string>();
    const merged: CompanySkill[] = [];
    for (const s of apiSkills) {
      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
    }
    for (const s of companySkills ?? []) {
      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
    }
    return merged;
  })();

  // Filter by compatible providers if agent has a provider set
  const filtered = allSkills.filter((skill) => {
    const providers = skill.metadata?.compatibleProviders;
    if (!providers || providers.length === 0 || !values.provider) return true;
    return providers.includes(values.provider);
  });

  if (!loaded && apiSkills.length === 0 && (!companySkills || companySkills.length === 0)) {
    return null;
  }

  if (filtered.length === 0) {
    return (
      <p className="text-[11px] text-[var(--text-tertiary)]">
        No compatible skills available{values.provider ? ` for ${values.provider}` : ""}.
      </p>
    );
  }

  // Group by category
  const categories = new Map<string, CompanySkill[]>();
  for (const s of filtered) {
    const cat = s.metadata?.category ?? "other";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(s);
  }

  const toggle = (id: string) => {
    const next = values.skillIds.includes(id)
      ? values.skillIds.filter((sid) => sid !== id)
      : [...values.skillIds, id];
    onChange({ skillIds: next });
  };

  return (
    <div className="space-y-3">
      {Array.from(categories.entries()).map(([cat, skills]) => (
        <div key={cat}>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
            {cat}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {skills.map((skill) => {
              const checked = values.skillIds.includes(skill.id);
              const style = SKILL_SOURCE_STYLES[skill.source] || SKILL_SOURCE_STYLES.custom;
              const icon = skill.metadata?.icon ?? style.icon;
              return (
                <label
                  key={skill.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                    checked
                      ? "border-[#00f0ff]/30 bg-[#00f0ff]/5"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(skill.id)}
                    className="sr-only"
                  />
                  <span className="text-base flex-shrink-0">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <span className={`text-xs font-medium ${checked ? "text-[#00f0ff]" : "text-[var(--text-primary)]"}`}>
                      {skill.name}
                    </span>
                    {skill.description && (
                      <p className="text-[9px] leading-tight text-[var(--text-tertiary)] line-clamp-1">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  {checked && (
                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[#00f0ff]" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-[var(--text-tertiary)]">
        Select skills this agent can use. CLI skills determine the execution adapter.
      </p>
    </div>
  );
}

export function AgentConfigFields({ values, onChange, existingAgents, companySkills, companyId }: AgentConfigFieldsProps) {
  const isLocal = LOCAL_ADAPTERS.includes(values.adapterType);
  const isGateway = GATEWAY_ADAPTERS.includes(values.adapterType);
  const isHttp = HTTP_ADAPTERS.includes(values.adapterType);
  const isOpenRouter = OPENROUTER_ADAPTERS.includes(values.adapterType);
  const showModel = values.adapterType !== "http";
  const showThinkingEffort = values.adapterType !== "gemini_local" && values.adapterType !== "http";

  // Reports-to options
  const reportsToOptions = [
    { value: "", label: "None" },
    { value: "me", label: "Me (you)" },
    ...(existingAgents ?? []).map((a) => ({
      value: a.callsign,
      label: `${a.name} (${a.callsign})`,
    })),
  ];

  return (
    <div className="space-y-0">
      {/* ── IDENTITY ── */}
      <Section title="Identity" defaultOpen collapsible={false}>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>NAME</label>
            <input
              type="text"
              value={values.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g., Neo"
              className={`mt-1 ${inputClass}`}
            />
          </div>

          <div>
            <label className={labelClass}>CALLSIGN</label>
            <input
              type="text"
              value={values.callsign}
              onChange={(e) => onChange({ callsign: e.target.value.toUpperCase() })}
              placeholder="AUTO-GENERATED"
              className={`mt-1 ${inputClass}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>ROLE</label>
              <div className="mt-1">
                <Dropdown value={values.role} options={ROLES} onChange={(v) => onChange({ role: v })} />
              </div>
            </div>
            <div>
              <label className={labelClass}>REPORTS TO</label>
              <div className="mt-1">
                <Dropdown
                  value={values.reportsTo}
                  options={reportsToOptions}
                  onChange={(v) => onChange({ reportsTo: v })}
                  placeholder="None"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>EMOJI</label>
              <input
                type="text"
                value={values.emoji}
                onChange={(e) => onChange({ emoji: e.target.value })}
                placeholder="\u{1F916}"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass}>COLOR</label>
              <div className="mt-1 flex items-center gap-2">
                <div
                  className="h-[34px] w-8 flex-shrink-0 rounded-md border border-[var(--border-subtle)]"
                  style={{ backgroundColor: values.color || "#00f0ff" }}
                />
                <input
                  type="text"
                  value={values.color}
                  onChange={(e) => onChange({ color: e.target.value })}
                  placeholder="#00f0ff"
                  className={`${inputClass} flex-1`}
                />
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── ADAPTER ── */}
      <Section title="Adapter" defaultOpen collapsible={false}>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>ADAPTER TYPE</label>
            <div className="mt-1">
              <Dropdown
                value={values.adapterType}
                options={ADAPTER_TYPES}
                onChange={(v) => {
                  const inferredProvider = ADAPTER_TO_PROVIDER[v] ?? "";
                  onChange({ adapterType: v, provider: inferredProvider });
                }}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>PROVIDER</label>
            <div className="mt-1">
              <Dropdown
                value={values.provider}
                options={PROVIDERS}
                onChange={(v) => onChange({ provider: v, model: "" })}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Determines which models are available. Add API keys in Settings.
            </p>
          </div>

          {showModel && (
            <div>
              <label className={labelClass}>MODEL</label>
              <div className="mt-1">
                {values.provider && companyId ? (
                  <DynamicModelSelector
                    value={values.model}
                    provider={values.provider}
                    adapterType={values.adapterType}
                    companyId={companyId}
                    onChange={(v) => onChange({ model: v })}
                  />
                ) : (
                  <ModelInput
                    value={values.model}
                    adapterType={values.adapterType}
                    onChange={(v) => onChange({ model: v })}
                  />
                )}
              </div>
            </div>
          )}

          {showThinkingEffort && (
            <div>
              <label className={labelClass}>THINKING EFFORT</label>
              <div className="mt-1">
                <Dropdown
                  value={values.thinkingEffort}
                  options={THINKING_EFFORT_OPTIONS}
                  onChange={(v) => onChange({ thinkingEffort: v })}
                />
              </div>
            </div>
          )}

          {isLocal && (
            <>
              <div>
                <label className={labelClass}>COMMAND</label>
                <input
                  type="text"
                  value={values.command}
                  onChange={(e) => onChange({ command: e.target.value })}
                  placeholder={COMMAND_PLACEHOLDERS[values.adapterType] ?? "command"}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label className={labelClass}>WORKSPACE PATH</label>
                <input
                  type="text"
                  value={values.workspacePath}
                  onChange={(e) => onChange({ workspacePath: e.target.value })}
                  placeholder="/path/to/project"
                  className={`mt-1 ${inputClass}`}
                />
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── GATEWAY CONFIG ── */}
      {isGateway && (
        <Section title="Gateway Config" defaultOpen collapsible={false}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>GATEWAY URL</label>
              <input
                type="text"
                value={values.gatewayUrl}
                onChange={(e) => onChange({ gatewayUrl: e.target.value })}
                placeholder="ws://127.0.0.1:18789"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass}>AUTH TOKEN</label>
              <div className="mt-1">
                <PasswordInput
                  value={values.gatewayToken}
                  onChange={(v) => onChange({ gatewayToken: v })}
                  placeholder="OpenClaw gateway token"
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── HTTP CONFIG ── */}
      {isHttp && (
        <Section title="HTTP Config" defaultOpen collapsible={false}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>API URL</label>
              <input
                type="text"
                value={values.httpUrl}
                onChange={(e) => onChange({ httpUrl: e.target.value })}
                placeholder="https://api.example.com/agent"
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass}>AUTHORIZATION HEADER</label>
              <div className="mt-1">
                <PasswordInput
                  value={values.httpAuthHeader}
                  onChange={(v) => onChange({ httpAuthHeader: v })}
                  placeholder="Bearer sk-..."
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── OPENROUTER CONFIG ── */}
      {isOpenRouter && (
        <Section title="OpenRouter Config" defaultOpen collapsible={false}>
          <div className="space-y-3">
            <div>
              <label className={labelClass}>API KEY</label>
              <div className="mt-1">
                <PasswordInput
                  value={values.openrouterApiKey}
                  onChange={(v) => onChange({ openrouterApiKey: v })}
                  placeholder="sk-or-v1-..."
                />
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                Get your key at openrouter.ai/keys
              </p>
            </div>
            <div>
              <label className={labelClass}>BASE URL (OPTIONAL)</label>
              <input
                type="text"
                value={values.openrouterBaseUrl}
                onChange={(e) => onChange({ openrouterBaseUrl: e.target.value })}
                placeholder="https://openrouter.ai/api/v1"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          </div>
        </Section>
      )}

      {/* ── PROMPT & INSTRUCTIONS ── */}
      <Section title="Prompt & Instructions">
        <div className="space-y-3">
          <div>
            <label className={labelClass}>PROMPT TEMPLATE</label>
            <textarea
              value={values.promptTemplate}
              onChange={(e) => onChange({ promptTemplate: e.target.value })}
              rows={6}
              placeholder={"You are {{ agent.name }}. Your role is {{ agent.role }}..."}
              className={`mt-1 ${inputClass}`}
            />
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Defines the agent&apos;s personality and behavior. Supports variables like {"{{ agent.name }}"}, {"{{ agent.role }}"}.
            </p>
          </div>
          <div>
            <label className={labelClass}>INSTRUCTIONS FILE</label>
            <input
              type="text"
              value={values.instructionsFile}
              onChange={(e) => onChange({ instructionsFile: e.target.value })}
              placeholder="/path/to/AGENTS.md"
              className={`mt-1 ${inputClass}`}
            />
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Path to a markdown file injected into the agent&apos;s system prompt at runtime.
            </p>
          </div>
          {isLocal && (
            <div>
              <label className={labelClass}>EXTRA CLI ARGS</label>
              <input
                type="text"
                value={values.extraArgs}
                onChange={(e) => onChange({ extraArgs: e.target.value })}
                placeholder="--verbose, --foo=bar"
                className={`mt-1 ${inputClass}`}
              />
            </div>
          )}
        </div>
      </Section>

      {/* ── ENVIRONMENT VARIABLES ── */}
      <Section title="Environment Variables">
        <EnvVarEditor envVars={values.envVars} onChange={(v) => onChange({ envVars: v })} />
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          {isLocal
            ? "Injected into the agent\u2019s process environment at runtime."
            : "Passed to the agent as context variables."}
        </p>
      </Section>

      {/* ── RUN POLICY ── */}
      <Section title="Run Policy">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className={labelClass}>HEARTBEAT ENABLED</label>
            <Toggle
              checked={values.heartbeatEnabled}
              onChange={(v) => onChange({ heartbeatEnabled: v })}
            />
          </div>

          {values.heartbeatEnabled && (
            <div>
              <label className={labelClass}>HEARTBEAT INTERVAL</label>
              <div className="mt-1">
                <NumberInput
                  value={values.heartbeatIntervalSec}
                  onChange={(v) => onChange({ heartbeatIntervalSec: v })}
                  suffix="sec"
                  min={10}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className={labelClass}>WAKE ON DEMAND</label>
            <Toggle
              checked={values.wakeOnDemand}
              onChange={(v) => onChange({ wakeOnDemand: v })}
            />
          </div>

          <div>
            <label className={labelClass}>COOLDOWN</label>
            <div className="mt-1">
              <NumberInput
                value={values.cooldownSec}
                onChange={(v) => onChange({ cooldownSec: v })}
                suffix="sec"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>MAX CONCURRENT RUNS</label>
            <div className="mt-1">
              <NumberInput
                value={values.maxConcurrentRuns}
                onChange={(v) => onChange({ maxConcurrentRuns: v })}
                min={1}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>TIMEOUT</label>
            <div className="mt-1">
              <NumberInput
                value={values.timeoutSec}
                onChange={(v) => onChange({ timeoutSec: v })}
                suffix="sec"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>GRACE PERIOD</label>
            <div className="mt-1">
              <NumberInput
                value={values.gracePeriodSec}
                onChange={(v) => onChange({ gracePeriodSec: v })}
                suffix="sec"
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── SKILLS ── */}
      <Section title="Skills" defaultOpen>
        <SkillsGrid
          values={values}
          onChange={onChange}
          companyId={companyId}
          companySkills={companySkills}
        />
      </Section>
    </div>
  );
}
