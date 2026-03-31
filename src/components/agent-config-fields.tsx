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
  { value: "ceo", label: "CEO" },
  { value: "cto", label: "CTO" },
  { value: "engineer", label: "Engineer" },
  { value: "designer", label: "Designer" },
  { value: "qa", label: "QA" },
  { value: "devops", label: "DevOps" },
  { value: "researcher", label: "Researcher" },
  { value: "custom", label: "Custom" },
];

export const LOCAL_ADAPTERS = ["claude_local", "codex_local", "gemini_local", "opencode_local", "cursor", "pi_local"];
export const GATEWAY_ADAPTERS = ["openclaw_gateway"];
export const HTTP_ADAPTERS = ["http"];
export const OPENROUTER_ADAPTERS = ["openrouter"];

const MODELS_BY_ADAPTER: Record<string, string[]> = {
  claude_local: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
  codex_local: ["o4-mini", "o3", "gpt-4.1"],
  gemini_local: ["gemini-2.5-pro", "gemini-2.5-flash"],
  cursor: ["claude-sonnet-4-20250514", "gpt-4.1"],
  openrouter: [
    "anthropic/claude-sonnet-4-20250514",
    "anthropic/claude-opus-4-20250514",
    "openai/gpt-4.1",
    "openai/o4-mini",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-r1",
    "meta-llama/llama-4-maverick",
  ],
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
}

export function defaultAgentConfigValues(): AgentConfigValues {
  return {
    name: "",
    callsign: "",
    role: "engineer",
    adapterType: "claude_local",
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
  };
}

export function nameToCallsign(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

interface AgentConfigFieldsProps {
  values: AgentConfigValues;
  onChange: (patch: Partial<AgentConfigValues>) => void;
  existingAgents?: { id: string; name: string; callsign: string }[];
}

// ─── Styling ────────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white placeholder:text-white/25 outline-none focus:border-[#00f0ff]/40 transition-colors";
const labelClass = "font-mono text-[11px] tracking-wider text-white/50 uppercase";
const sectionHeaderClass = "font-mono text-xs tracking-[0.15em] text-white/60 uppercase";

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
        <span className={selected ? "text-white" : "text-white/25"}>
          {selected?.label ?? placeholder ?? "Select..."}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-white/35 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-white/[0.08] bg-[#0d1117] py-1 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left font-mono text-sm transition-colors hover:bg-white/[0.06] ${
                o.value === value ? "text-[#00f0ff]" : "text-white/70"
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

function ModelCombo({
  value,
  adapterType,
  onChange,
}: {
  value: string;
  adapterType: string;
  onChange: (val: string) => void;
}) {
  const presets = MODELS_BY_ADAPTER[adapterType] ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => presets.length > 0 && setOpen(true)}
          placeholder={presets.length > 0 ? presets[0] : "Model name"}
          className={inputClass}
        />
        {presets.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
          >
            <svg
              className={`h-3.5 w-3.5 text-white/35 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        )}
      </div>
      {open && presets.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-white/[0.08] bg-[#0d1117] py-1 shadow-xl">
          {presets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left font-mono text-sm transition-colors hover:bg-white/[0.06] ${
                m === value ? "text-[#00f0ff]" : "text-white/70"
              }`}
            >
              {m}
            </button>
          ))}
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
        checked ? "bg-[#00f0ff]/30" : "bg-white/[0.08]"
      }`}
    >
      <div
        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
          checked ? "left-[18px] bg-[#00f0ff]" : "left-0.5 bg-white/40"
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
    <div className="border-b border-white/[0.06]">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex w-full items-center justify-between py-3 ${collapsible ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={sectionHeaderClass}>{title}</span>
        {collapsible && (
          <svg
            className={`h-3.5 w-3.5 text-white/35 transition-transform ${open ? "rotate-180" : ""}`}
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
        className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-white/35 transition-colors hover:text-white/60"
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
              className="flex-shrink-0 font-mono text-sm text-white/35 transition-colors hover:text-red-400"
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
      {suffix && <span className="font-mono text-[11px] text-white/35">{suffix}</span>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function AgentConfigFields({ values, onChange, existingAgents }: AgentConfigFieldsProps) {
  const isLocal = LOCAL_ADAPTERS.includes(values.adapterType);
  const isGateway = GATEWAY_ADAPTERS.includes(values.adapterType);
  const isHttp = HTTP_ADAPTERS.includes(values.adapterType);
  const isOpenRouter = OPENROUTER_ADAPTERS.includes(values.adapterType);
  const showModel = values.adapterType !== "http";
  const showThinkingEffort = values.adapterType !== "gemini_local" && values.adapterType !== "http";

  // Reports-to options
  const reportsToOptions = [
    { value: "", label: "None" },
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
                  className="h-[34px] w-8 flex-shrink-0 rounded-md border border-white/[0.06]"
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
                onChange={(v) => onChange({ adapterType: v })}
              />
            </div>
          </div>

          {showModel && (
            <div>
              <label className={labelClass}>MODEL</label>
              <div className="mt-1">
                <ModelCombo
                  value={values.model}
                  adapterType={values.adapterType}
                  onChange={(v) => onChange({ model: v })}
                />
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
              <p className="mt-1 font-mono text-[11px] text-white/35">
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
      {isLocal && (
        <Section title="Prompt & Instructions">
          <div className="space-y-3">
            <div>
              <label className={labelClass}>PROMPT TEMPLATE</label>
              <textarea
                value={values.promptTemplate}
                onChange={(e) => onChange({ promptTemplate: e.target.value })}
                rows={6}
                placeholder={"You are {{ agent.name }}..."}
                className={`mt-1 ${inputClass} font-mono`}
              />
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
            </div>
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
          </div>
        </Section>
      )}

      {/* ── ENVIRONMENT VARIABLES ── */}
      {isLocal && (
        <Section title="Environment Variables">
          <EnvVarEditor envVars={values.envVars} onChange={(v) => onChange({ envVars: v })} />
        </Section>
      )}

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
    </div>
  );
}
