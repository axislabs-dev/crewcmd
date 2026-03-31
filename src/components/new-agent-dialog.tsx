"use client";

import { useState } from "react";

const ADAPTER_TYPES = [
  { value: "claude_local", label: "Claude Code (Local)" },
  { value: "codex_local", label: "Codex (Local)" },
  { value: "gemini_local", label: "Gemini CLI (Local)" },
  { value: "opencode_local", label: "OpenCode (Local)" },
  { value: "openclaw_gateway", label: "OpenClaw Gateway" },
  { value: "cursor", label: "Cursor (Local)" },
  { value: "pi_local", label: "Pi (Local)" },
  { value: "process", label: "Process" },
  { value: "http", label: "HTTP" },
];

const ROLES = [
  { value: "ceo", label: "CEO" },
  { value: "cto", label: "CTO" },
  { value: "engineer", label: "Engineer" },
  { value: "designer", label: "Designer" },
  { value: "qa", label: "QA" },
  { value: "devops", label: "DevOps" },
  { value: "researcher", label: "Researcher" },
  { value: "custom", label: "Custom" },
];

const LOCAL_ADAPTERS = ["claude_local", "codex_local", "gemini_local", "opencode_local", "cursor", "pi_local"];

function nameToCallsign(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

interface NewAgentDialogProps {
  companyId: string | null;
  onCreated: () => void;
  onClose: () => void;
}

export function NewAgentDialog({ companyId, onCreated, onClose }: NewAgentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [callsign, setCallsign] = useState("");
  const [callsignManual, setCallsignManual] = useState(false);
  const [role, setRole] = useState("engineer");
  const [adapterType, setAdapterType] = useState("claude_local");
  const [model, setModel] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [color, setColor] = useState("#00f0ff");

  async function handleSubmit() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          callsign: (callsign.trim() || nameToCallsign(name)).toUpperCase(),
          title: ROLES.find((r) => r.value === role)?.label || "Agent",
          emoji: emoji || "\u{1F916}",
          color: color || "#00f0ff",
          adapterType,
          adapterConfig: {},
          role,
          model: model.trim() || null,
          workspacePath: workspacePath.trim() || null,
          companyId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create agent");
        return;
      }

      onCreated();
    } catch {
      setError("Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50";
  const selectClass =
    "mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50 appearance-none";
  const labelClass = "block font-mono text-[11px] tracking-wider text-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/[0.08] bg-[#0a0a0f] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">NEW AGENT</h2>
          <button
            onClick={onClose}
            className="font-mono text-xs text-white/35 transition-colors hover:text-white/60"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelClass}>NAME</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!callsignManual) {
                    setCallsign(nameToCallsign(e.target.value));
                  }
                }}
                placeholder="e.g., Neo"
                className={inputClass}
                autoFocus
              />
            </div>

            <div className="col-span-2">
              <label className={labelClass}>CALLSIGN</label>
              <input
                type="text"
                value={callsign}
                onChange={(e) => {
                  setCallsign(e.target.value.toUpperCase());
                  setCallsignManual(true);
                }}
                placeholder="AUTO-GENERATED"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>ROLE</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={selectClass}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>ADAPTER TYPE</label>
              <select
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value)}
                className={selectClass}
              >
                {ADAPTER_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className={labelClass}>MODEL (OPTIONAL)</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g., claude-sonnet-4-5-20250514"
                className={inputClass}
              />
            </div>

            {LOCAL_ADAPTERS.includes(adapterType) && (
              <div className="col-span-2">
                <label className={labelClass}>WORKSPACE PATH (OPTIONAL)</label>
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="/path/to/project"
                  className={inputClass}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>EMOJI</label>
              <input
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="\u{1F916}"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>COLOR</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-[42px] w-10 cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.03]"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#00f0ff"
                  className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-white/[0.08] px-4 py-2.5 font-mono text-xs tracking-wider text-white/40 transition-colors hover:bg-white/[0.04]"
            >
              CANCEL
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !name.trim()}
              className="flex-1 rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
            >
              {loading ? "CREATING..." : "CREATE AGENT"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
