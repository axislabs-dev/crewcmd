"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BUILT_IN_BLUEPRINTS, type BuiltInBlueprint } from "@/lib/blueprints-data";

// ─── Category pills ──────────────────────────────────────────────────

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "development", label: "Engineering" },
  { value: "marketing", label: "Marketing" },
  { value: "creative", label: "Creative" },
  { value: "support", label: "Support" },
  { value: "operations", label: "Operations" },
  { value: "founder", label: "Founder" },
];

// ─── Main Page ───────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Company
  const [companyName, setCompanyName] = useState("");
  const [companyMission, setCompanyMission] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);

  // Step 2: Team (blueprint, scratch, or connect runtime)
  const [teamMode, setTeamMode] = useState<"choose" | "blueprint" | "scratch" | "connect" | null>(null);
  const [selectedBlueprint, setSelectedBlueprint] = useState<BuiltInBlueprint | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Step 2 scratch: single simple agent
  const [agentName, setAgentName] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("🤖");
  const [agentRole, setAgentRole] = useState("engineer");

  // Step 2c: Connect runtime
  const [connectMode, setConnectMode] = useState<"choose" | "gateway" | "local">("choose");
  const [gatewayUrl, setGatewayUrl] = useState("localhost:18789");
  const [authToken, setAuthToken] = useState("");
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    error?: string;
    pairingRequired?: boolean;
    pairingInstructions?: string;
    agents: { id: string; name: string; emoji: string; title: string; description: string; model?: string; reportsTo?: string }[];
    models: { id: string; name: string; provider: string }[];
    defaultAgentId?: string;
    devicePrivateKeyPem?: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  // Persist device key across retries (probeResult gets cleared on each attempt)
  const [deviceKeyPem, setDeviceKeyPem] = useState<string | undefined>();
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Step 3: Invite
  const [invites, setInvites] = useState<string[]>([""]);

  // ── Handlers ──

  async function handleCreateCompany() {
    if (!companyName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyName.trim(),
          mission: companyMission.trim() || null,
        }),
      });
      if (res.ok) {
        const company = await res.json();
        setCompanyId(company.id);
        document.cookie = `active_company=${company.id};path=/;max-age=${60 * 60 * 24 * 365}`;
        setStep(2);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleDeployBlueprint() {
    if (!selectedBlueprint || !companyId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/blueprints/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: `builtin-${selectedBlueprint.slug}`,
          companyId,
        }),
      });
      if (res.ok) {
        setStep(3);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSingleAgent() {
    if (!agentName.trim() || !companyId) return;
    setLoading(true);
    try {
      const callsign = agentName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "AGENT";
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName.trim(),
          callsign,
          title: SIMPLE_ROLES.find((r) => r.value === agentRole)?.label || "Agent",
          emoji: agentEmoji || "🤖",
          color: "#00f0ff",
          adapterType: "claude_local",
          adapterConfig: {},
          role: agentRole,
          companyId,
        }),
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setStep(3);
    }
  }

  async function handleProbeGateway() {
    if (!gatewayUrl.trim() || !authToken.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/runtimes/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "gateway",
          url: gatewayUrl.trim(),
          token: authToken.trim(),
          // Reuse device key so the gateway sees the same device on retry
          deviceKeyPem: deviceKeyPem,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProbeResult({ ok: false, error: data.error || "Connection failed", agents: [], models: [] });
      } else if (data.pairingRequired) {
        // Save the device key so retries use the same identity
        if (data.devicePrivateKeyPem) setDeviceKeyPem(data.devicePrivateKeyPem);
        setProbeResult({
          ok: false,
          pairingRequired: true,
          pairingInstructions: data.pairingInstructions,
          devicePrivateKeyPem: data.devicePrivateKeyPem,
          agents: [],
          models: [],
        });
      } else {
        // Save the device key from successful connection too
        if (data.devicePrivateKeyPem) setDeviceKeyPem(data.devicePrivateKeyPem);
        setProbeResult(data);
        setSelectedAgentIds(new Set(data.agents.map((a: { id: string }) => a.id)));
      }
    } catch {
      setProbeResult({ ok: false, error: "Failed to connect to gateway", agents: [], models: [] });
    } finally {
      setProbing(false);
    }
  }

  async function handleProbeLocal() {
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/runtimes/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "local" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProbeResult({ ok: false, error: data.error || "Config not found", agents: [], models: [] });
      } else {
        setProbeResult(data);
        setSelectedAgentIds(new Set(data.agents.map((a: { id: string }) => a.id)));
      }
    } catch {
      setProbeResult({ ok: false, error: "Failed to read local config", agents: [], models: [] });
    } finally {
      setProbing(false);
    }
  }

  function toggleAgentSelection(agentId: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  async function handleImportAgents() {
    if (!probeResult || !companyId || selectedAgentIds.size === 0) return;
    setImporting(true);
    try {
      // First, create or update the runtime
      const runtimeRes = await fetch("/api/runtimes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "OpenClaw Gateway",
          runtimeType: "openclaw",
          gatewayUrl: gatewayUrl.trim().startsWith("ws") ? gatewayUrl.trim() : `ws://${gatewayUrl.trim()}`,
          httpUrl: gatewayUrl.trim().startsWith("http") ? gatewayUrl.trim() : `http://${gatewayUrl.trim()}`,
          authToken: authToken.trim() || null,
          companyId,
        }),
      });

      let runtimeId: string | null = null;
      if (runtimeRes.ok) {
        const runtime = await runtimeRes.json();
        runtimeId = runtime.id;
      }

      // Import agents
      const selectedAgents = probeResult.agents.filter((a) => selectedAgentIds.has(a.id));

      if (runtimeId) {
        // Use the import endpoint which handles deduplication + device key persistence
        await fetch("/api/runtimes/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runtimeId,
            agents: selectedAgents,
            models: probeResult.models,
            defaultAgentId: probeResult.defaultAgentId,
            devicePrivateKeyPem: probeResult.devicePrivateKeyPem,
          }),
        });
      } else {
        // Fallback: create agents directly
        for (const agent of selectedAgents) {
          const callsign = agent.id.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "AGENT";
          await fetch("/api/agents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: agent.name,
              callsign,
              title: agent.title || "Agent",
              emoji: agent.emoji || "🤖",
              color: "#00f0ff",
              adapterType: "openclaw_gateway",
              adapterConfig: {
                gatewayUrl: `ws://${gatewayUrl.trim()}`,
                agentId: agent.id,
                model: agent.model,
                devicePrivateKeyPem: probeResult.devicePrivateKeyPem,
              },
              role: "agent",
              companyId,
              reportsTo: agent.reportsTo || null,
            }),
          });
        }
      }

      setStep(3);
    } catch {
      // ignore
    } finally {
      setImporting(false);
    }
  }

  async function handleInviteMembers() {
    if (!companyId) return;
    setLoading(true);
    const validInvites = invites.filter((u) => u.trim());
    try {
      await Promise.all(
        validInvites.map((username) =>
          fetch(`/api/companies/${companyId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ githubUsername: username.trim(), role: "member" }),
          })
        )
      );
    } catch {
      // ignore
    } finally {
      setLoading(false);
      router.push("/dashboard");
    }
  }

  // ── Rendering ──

  const totalSteps = 3;
  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]/50";
  const labelClass = "block text-[11px] tracking-wider text-[var(--text-tertiary)]";
  const btnPrimary =
    "rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50";
  const btnSecondary =
    "rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]";

  const filteredBlueprints =
    categoryFilter === "all"
      ? BUILT_IN_BLUEPRINTS
      : BUILT_IN_BLUEPRINTS.filter((b) => b.category === categoryFilter);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-mono text-xl font-bold tracking-wider text-[var(--accent)]">
            WELCOME TO CREWCMD
          </h1>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            Let&apos;s set up your crew in a few quick steps.
          </p>
        </div>

        {/* Step indicator */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs transition-colors ${
                  s === step
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : s < step
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)]"
                }`}
              >
                {s < step ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  s
                )}
              </div>
              {s < totalSteps && (
                <div className={`h-px w-8 ${s < step ? "bg-emerald-500/30" : "bg-[var(--bg-surface-hover)]"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          {/* ── Step 1: Company ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                  CREATE YOUR COMPANY
                </h2>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  This is your organization — the home for your agent crew.
                </p>
              </div>
              <div>
                <label className={labelClass}>COMPANY NAME</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g., Acme Corp"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>MISSION (OPTIONAL)</label>
                <textarea
                  value={companyMission}
                  onChange={(e) => setCompanyMission(e.target.value)}
                  rows={2}
                  placeholder="What's your crew working towards?"
                  className={inputClass}
                />
              </div>
              <button
                onClick={handleCreateCompany}
                disabled={loading || !companyName.trim()}
                className={`w-full ${btnPrimary}`}
              >
                {loading ? "CREATING..." : "CREATE COMPANY"}
              </button>
            </div>
          )}

          {/* ── Step 2: Build Your Team ── */}
          {step === 2 && !teamMode && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                  BUILD YOUR TEAM
                </h2>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  Choose a pre-built team blueprint or create your first agent from scratch.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* Blueprint option */}
                <button
                  onClick={() => setTeamMode("blueprint")}
                  className="group rounded-xl border border-[var(--border-medium)] p-5 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/30"
                >
                  <div className="text-2xl">🏗️</div>
                  <h3 className="mt-2 text-xs font-bold tracking-wider text-[var(--text-primary)]">
                    CHOOSE A BLUEPRINT
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Pre-configured teams with roles, hierarchy, and prompts. Deploy a whole crew in one click.
                  </p>
                </button>

                {/* Connect runtime option */}
                <button
                  onClick={() => setTeamMode("connect")}
                  className="group rounded-xl border border-[var(--border-medium)] p-5 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/30"
                >
                  <div className="text-2xl">🔌</div>
                  <h3 className="mt-2 text-xs font-bold tracking-wider text-[var(--text-primary)]">
                    CONNECT RUNTIME
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Import your existing agent team from an OpenClaw gateway. Local or remote.
                  </p>
                </button>

                {/* From scratch option */}
                <button
                  onClick={() => setTeamMode("scratch")}
                  className="group rounded-xl border border-[var(--border-medium)] p-5 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/30"
                >
                  <div className="text-2xl">✏️</div>
                  <h3 className="mt-2 text-xs font-bold tracking-wider text-[var(--text-primary)]">
                    START FROM SCRATCH
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Create your first agent manually. Add more agents later from the team page.
                  </p>
                </button>
              </div>

              <button
                onClick={() => setStep(3)}
                className={`w-full ${btnSecondary}`}
              >
                SKIP FOR NOW
              </button>
            </div>
          )}

          {/* ── Step 2a: Blueprint picker ── */}
          {step === 2 && teamMode === "blueprint" && !selectedBlueprint && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    CHOOSE A BLUEPRINT
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    {BUILT_IN_BLUEPRINTS.length} team templates ready to deploy.
                  </p>
                </div>
                <button
                  onClick={() => setTeamMode(null)}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              {/* Category filter */}
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => setCategoryFilter(cat.value)}
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider transition-colors ${
                      categoryFilter === cat.value
                        ? "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-medium)]"
                        : "bg-[var(--bg-surface-hover)] text-[var(--text-tertiary)] border border-transparent hover:border-[var(--border-medium)]"
                    }`}
                  >
                    {cat.label.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Blueprint cards */}
              <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                {filteredBlueprints.map((bp) => (
                  <button
                    key={bp.slug}
                    onClick={() => setSelectedBlueprint(bp)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] p-3 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/20"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{bp.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                            {bp.name}
                          </span>
                          <span className="ml-2 shrink-0 rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 font-mono text-[9px] text-[var(--text-tertiary)]">
                            {bp.agentCount} AGENTS
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)] line-clamp-1">
                          {bp.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2a: Blueprint preview ── */}
          {step === 2 && teamMode === "blueprint" && selectedBlueprint && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{selectedBlueprint.icon}</span>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    {selectedBlueprint.name.toUpperCase()}
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedBlueprint(null)}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              <p className="text-[11px] text-[var(--text-tertiary)]">
                {selectedBlueprint.template.description}
              </p>

              {/* Org chart preview */}
              <div className="space-y-1.5">
                <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">TEAM</span>
                <div className="space-y-1">
                  {selectedBlueprint.template.agents.map((agent) => {
                    const isLead = !agent.reportsTo;
                    return (
                      <div
                        key={agent.callsign}
                        className={`flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 ${
                          isLead ? "bg-[var(--accent-soft)]/20" : "ml-6"
                        }`}
                      >
                        <span className="text-sm">{agent.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-[var(--text-primary)]">
                            {agent.name}
                          </span>
                          <span className="ml-2 text-[10px] text-[var(--text-tertiary)]">
                            {agent.title}
                          </span>
                        </div>
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: agent.color }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedBlueprint(null)}
                  className={`flex-1 ${btnSecondary}`}
                >
                  PICK ANOTHER
                </button>
                <button
                  onClick={handleDeployBlueprint}
                  disabled={loading}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {loading ? "DEPLOYING..." : `DEPLOY ${selectedBlueprint.agentCount} AGENTS`}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2c: Connect runtime — choose method ── */}
          {step === 2 && teamMode === "connect" && connectMode === "choose" && !probeResult?.ok && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    CONNECT TO OPENCLAW
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Connect to your OpenClaw gateway to import your agent team.
                  </p>
                </div>
                <button
                  onClick={() => { setTeamMode(null); setProbeResult(null); setConnectMode("choose"); }}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setConnectMode("gateway")}
                  className="group rounded-xl border border-[var(--border-medium)] p-5 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/30"
                >
                  <div className="text-2xl">🔌</div>
                  <h3 className="mt-2 text-xs font-bold tracking-wider text-[var(--text-primary)]">
                    CONNECT TO GATEWAY
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Enter your gateway URL and auth token. Works for local and remote gateways.
                  </p>
                </button>

                <button
                  onClick={() => {
                    setConnectMode("local");
                    handleProbeLocal();
                  }}
                  className="group rounded-xl border border-[var(--border-medium)] p-5 text-left transition-all hover:border-[var(--accent-medium)] hover:bg-[var(--accent-soft)]/30"
                >
                  <div className="text-2xl">🔍</div>
                  <h3 className="mt-2 text-xs font-bold tracking-wider text-[var(--text-primary)]">
                    AUTO-DETECT LOCAL
                  </h3>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    OpenClaw running on this machine? Auto-detect from config files.
                  </p>
                </button>
              </div>

              {probeResult && !probeResult.ok && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-[11px] text-red-400">
                    {probeResult.error || "Detection failed"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2c: Connect runtime — pairing required ── */}
          {step === 2 && teamMode === "connect" && probeResult?.pairingRequired && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    DEVICE PAIRING REQUIRED
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    CrewCmd registered as a new device. Approve it on your OpenClaw gateway host.
                  </p>
                </div>
                <button
                  onClick={() => { setProbeResult(null); setConnectMode("gateway"); }}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              {/* Pairing instructions */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔐</span>
                  <span className="text-[11px] font-bold tracking-wider text-amber-400">
                    APPROVE ON GATEWAY HOST
                  </span>
                </div>

                <p className="text-[11px] text-[var(--text-secondary)]">
                  Run this command on the machine running your OpenClaw gateway:
                </p>

                {/* Click-to-copy command */}
                {["openclaw devices approve"].map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => { navigator.clipboard.writeText(cmd); setCopiedCmd(cmd); setTimeout(() => setCopiedCmd(null), 2000); }}
                    className="group flex w-full items-center justify-between rounded-md bg-[var(--bg-tertiary)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
                  >
                    <code className="font-mono text-[12px] text-[var(--accent)]">{cmd}</code>
                    <span className="text-[10px] text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
                      {copiedCmd === cmd ? "✓ COPIED" : "CLICK TO COPY"}
                    </span>
                  </button>
                ))}

                <div className="flex items-center gap-2 pt-1">
                  <div className="h-px flex-1 bg-[var(--border-subtle)]" />
                  <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">OR</span>
                  <div className="h-px flex-1 bg-[var(--border-subtle)]" />
                </div>

                <p className="text-[10px] text-[var(--text-tertiary)]">
                  Via Telegram: send <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5">/pair pending</code> to your bot, then approve the request.
                </p>
              </div>

              <button
                onClick={handleProbeGateway}
                disabled={probing}
                className={`w-full ${btnPrimary}`}
              >
                {probing ? "RETRYING..." : "RETRY CONNECTION"}
              </button>
            </div>
          )}

          {/* ── Step 2c: Connect runtime — gateway connect ── */}
          {step === 2 && teamMode === "connect" && connectMode === "gateway" && !probeResult?.ok && !probeResult?.pairingRequired && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    CONNECT TO GATEWAY
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Enter your OpenClaw gateway URL and auth token. Device pairing is handled automatically.
                  </p>
                </div>
                <button
                  onClick={() => { setConnectMode("choose"); setProbeResult(null); }}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className={labelClass}>GATEWAY URL</label>
                  <input
                    type="text"
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    placeholder="localhost:18789"
                    className={`${inputClass} font-mono text-[11px]`}
                    autoFocus
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Default: <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5">localhost:18789</code> — use your remote IP for non-local gateways
                  </p>
                </div>

                <div>
                  <label className={labelClass}>AUTH TOKEN</label>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Your gateway auth token"
                    className={`${inputClass} font-mono text-[11px]`}
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Find in <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5">openclaw.json</code> → <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5">gateway.auth.token</code>
                  </p>
                </div>
              </div>

              {probeResult && !probeResult.ok && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-[11px] text-red-400">
                    {probeResult.error || "Connection failed"}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setConnectMode("choose"); setProbeResult(null); }}
                  className={`flex-1 ${btnSecondary}`}
                >
                  BACK
                </button>
                <button
                  onClick={handleProbeGateway}
                  disabled={probing || !gatewayUrl.trim() || !authToken.trim()}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {probing ? "CONNECTING..." : "CONNECT & DISCOVER"}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2c: Connect runtime — auto-detect loading ── */}
          {step === 2 && teamMode === "connect" && connectMode === "local" && probing && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="text-2xl animate-pulse">🔍</div>
                  <p className="mt-3 text-xs tracking-wider text-[var(--text-tertiary)]">
                    SCANNING LOCAL OPENCLAW CONFIG...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2c: Connect runtime — agent preview ── */}
          {step === 2 && teamMode === "connect" && probeResult?.ok && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    FOUND {probeResult.agents.length} AGENTS
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Detected from OpenClaw config. Select which agents to import.
                  </p>
                </div>
                <button
                  onClick={() => setProbeResult(null)}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              {/* Agent list */}
              <div className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
                {probeResult.agents.map((agent) => {
                  const isSelected = selectedAgentIds.has(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgentSelection(agent.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                        isSelected
                          ? "border-[var(--accent-medium)] bg-[var(--accent-soft)]/20"
                          : "border-[var(--border-subtle)] hover:border-[var(--border-medium)]"
                      }`}
                    >
                      {/* Checkbox */}
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                            : "border-[var(--border-medium)]"
                        }`}
                      >
                        {isSelected && (
                          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </div>

                      {/* Agent info */}
                      <span className="text-base shrink-0">{agent.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-[var(--text-primary)]">
                            {agent.name}
                          </span>
                          <span className="text-[9px] text-[var(--text-tertiary)] font-mono">
                            {agent.id}
                          </span>
                        </div>
                        {agent.title !== "Agent" && (
                          <p className="text-[10px] text-[var(--text-tertiary)] line-clamp-1">
                            {agent.title}
                          </p>
                        )}
                      </div>

                      {/* Status dot */}
                      <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    </button>
                  );
                })}
              </div>

              {/* Models info */}
              {probeResult.models.length > 0 && (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2">
                  <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
                    MODELS & PROVIDERS: {probeResult.models.length} detected
                  </span>
                  <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)] line-clamp-1">
                    {probeResult.models.join(", ")}
                  </p>
                </div>
              )}

              {/* Select all / none */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedAgentIds(new Set(probeResult.agents.map((a) => a.id)))}
                  className="text-[10px] text-[var(--accent)] hover:underline"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedAgentIds(new Set())}
                  className="text-[10px] text-[var(--text-tertiary)] hover:underline"
                >
                  Select none
                </button>
                <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                  {selectedAgentIds.size} of {probeResult.agents.length} selected
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setProbeResult(null)}
                  className={`flex-1 ${btnSecondary}`}
                >
                  BACK
                </button>
                <button
                  onClick={handleImportAgents}
                  disabled={importing || selectedAgentIds.size === 0}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {importing ? "IMPORTING..." : `IMPORT ${selectedAgentIds.size} AGENTS`}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2b: From scratch (simple) ── */}
          {step === 2 && teamMode === "scratch" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    CREATE YOUR FIRST AGENT
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    Keep it simple. You can configure advanced settings later.
                  </p>
                </div>
                <button
                  onClick={() => setTeamMode(null)}
                  className="text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  ← BACK
                </button>
              </div>

              <div>
                <label className={labelClass}>AGENT NAME</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g., Atlas, Pixel, Forge"
                  className={inputClass}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>EMOJI</label>
                  <input
                    type="text"
                    value={agentEmoji}
                    onChange={(e) => setAgentEmoji(e.target.value)}
                    placeholder="🤖"
                    className={inputClass}
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className={labelClass}>ROLE</label>
                  <select
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
                    className={`${inputClass} appearance-none`}
                  >
                    {SIMPLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep(3)} className={`flex-1 ${btnSecondary}`}>
                  SKIP
                </button>
                <button
                  onClick={handleCreateSingleAgent}
                  disabled={loading || !agentName.trim()}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {loading ? "CREATING..." : "CREATE AGENT"}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Invite ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                  INVITE YOUR TEAM
                </h2>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  Add team members by their GitHub username. You can skip this step.
                </p>
              </div>

              <div className="space-y-2">
                {invites.map((username, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        const next = [...invites];
                        next[i] = e.target.value;
                        setInvites(next);
                      }}
                      placeholder="GitHub username"
                      className={`flex-1 ${inputClass}`}
                    />
                    {invites.length > 1 && (
                      <button
                        onClick={() => setInvites(invites.filter((_, j) => j !== i))}
                        className="rounded-lg border border-[var(--border-subtle)] px-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setInvites([...invites, ""])}
                  className="text-[11px] text-[var(--accent)] transition-colors hover:text-[var(--accent)]"
                >
                  + ADD ANOTHER
                </button>
              </div>

              <div className="flex gap-2">
                <button onClick={() => router.push("/dashboard")} className={`flex-1 ${btnSecondary}`}>
                  SKIP
                </button>
                <button
                  onClick={handleInviteMembers}
                  disabled={loading || invites.every((u) => !u.trim())}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {loading ? "INVITING..." : "INVITE & CONTINUE"}
                </button>
              </div>
            </div>
          )}


        </div>
      </div>
    </div>
  );
}

// ── Simple roles for scratch mode (subset of full ROLES) ──

const SIMPLE_ROLES = [
  { value: "engineer", label: "Engineer" },
  { value: "designer", label: "Designer" },
  { value: "writer", label: "Writer" },
  { value: "analyst", label: "Analyst" },
  { value: "assistant", label: "Assistant" },
  { value: "manager", label: "Manager" },
  { value: "researcher", label: "Researcher" },
  { value: "support", label: "Support" },
  { value: "custom", label: "Custom" },
];
