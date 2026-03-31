"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
const GATEWAY_ADAPTERS = ["openclaw_gateway"];
const HTTP_ADAPTERS = ["http"];

function nameToCallsign(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Company
  const [companyName, setCompanyName] = useState("");
  const [companyMission, setCompanyMission] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);

  // Step 2: Agent
  const [agentName, setAgentName] = useState("");
  const [agentCallsign, setAgentCallsign] = useState("");
  const [agentCallsignManual, setAgentCallsignManual] = useState(false);
  const [agentRole, setAgentRole] = useState("engineer");
  const [agentAdapterType, setAgentAdapterType] = useState("claude_local");
  const [agentModel, setAgentModel] = useState("");
  const [agentWorkspacePath, setAgentWorkspacePath] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("\u{1F916}");
  const [agentColor, setAgentColor] = useState("#00f0ff");
  const [agentGatewayUrl, setAgentGatewayUrl] = useState("");
  const [agentGatewayToken, setAgentGatewayToken] = useState("");
  const [agentGatewayTokenVisible, setAgentGatewayTokenVisible] = useState(false);
  const [agentHttpUrl, setAgentHttpUrl] = useState("");
  const [agentHttpAuth, setAgentHttpAuth] = useState("");
  const [agentHttpAuthVisible, setAgentHttpAuthVisible] = useState(false);

  // Step 3: Invite
  const [invites, setInvites] = useState<string[]>([""]);

  // Step 4: Goal
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");

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

  async function handleCreateAgent() {
    if (!agentName.trim() || !companyId) return;
    setLoading(true);

    try {
      const callsign = agentCallsign.trim() || nameToCallsign(agentName);
      const adapterConfig: Record<string, unknown> = {};
      if (GATEWAY_ADAPTERS.includes(agentAdapterType)) {
        if (agentGatewayUrl.trim()) adapterConfig.url = agentGatewayUrl.trim();
        if (agentGatewayToken.trim()) {
          adapterConfig.headers = { "x-openclaw-token": agentGatewayToken.trim() };
        }
      } else if (HTTP_ADAPTERS.includes(agentAdapterType)) {
        if (agentHttpUrl.trim()) adapterConfig.url = agentHttpUrl.trim();
        if (agentHttpAuth.trim()) {
          adapterConfig.headers = { Authorization: agentHttpAuth.trim() };
        }
      }
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName.trim(),
          callsign,
          title: ROLES.find((r) => r.value === agentRole)?.label || "Agent",
          emoji: agentEmoji || "\u{1F916}",
          color: agentColor || "#00f0ff",
          adapterType: agentAdapterType,
          adapterConfig,
          role: agentRole,
          model: agentModel.trim() || null,
          workspacePath: agentWorkspacePath.trim() || null,
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
      // ignore failures
    } finally {
      setLoading(false);
      setStep(4);
    }
  }

  async function handleCreateGoal() {
    if (!companyId) return;
    setLoading(true);

    try {
      if (goalTitle.trim()) {
        await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            title: goalTitle.trim(),
            description: goalDescription.trim() || null,
          }),
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      router.push("/dashboard");
    }
  }

  const totalSteps = 4;

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs transition-colors ${
              s === step
                ? "bg-neo/20 text-neo"
                : s < step
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/[0.04] text-white/20"
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
            <div className={`h-px w-8 ${s < step ? "bg-emerald-500/30" : "bg-white/[0.06]"}`} />
          )}
        </div>
      ))}
    </div>
  );

  const inputClass =
    "mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50";
  const selectClass =
    "mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50 appearance-none";
  const labelClass = "block font-mono text-[11px] tracking-wider text-white/40";

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <h1 className="font-mono text-xl font-bold tracking-wider text-neo">WELCOME TO CREWCMD</h1>
          <p className="mt-2 font-mono text-xs text-white/35">
            Let&apos;s set up your crew in a few quick steps.
          </p>
        </div>

        <div className="mt-6">{stepIndicator}</div>

        <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          {/* Step 1: Create Company */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">CREATE YOUR COMPANY</h2>
                <p className="mt-1 font-mono text-[11px] text-white/35">
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
                className="w-full rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
              >
                {loading ? "CREATING..." : "CREATE COMPANY"}
              </button>
            </div>
          )}

          {/* Step 2: Create First Agent */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">CREATE YOUR FIRST AGENT</h2>
                <p className="mt-1 font-mono text-[11px] text-white/35">
                  Add an AI agent to your crew. You can add more later.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>NAME</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => {
                      setAgentName(e.target.value);
                      if (!agentCallsignManual) {
                        setAgentCallsign(nameToCallsign(e.target.value));
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
                    value={agentCallsign}
                    onChange={(e) => {
                      setAgentCallsign(e.target.value.toUpperCase());
                      setAgentCallsignManual(true);
                    }}
                    placeholder="AUTO-GENERATED"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>ROLE</label>
                  <select
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
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
                    value={agentAdapterType}
                    onChange={(e) => setAgentAdapterType(e.target.value)}
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
                    value={agentModel}
                    onChange={(e) => setAgentModel(e.target.value)}
                    placeholder="e.g., claude-sonnet-4-5-20250514"
                    className={inputClass}
                  />
                </div>

                {LOCAL_ADAPTERS.includes(agentAdapterType) && (
                  <div className="col-span-2">
                    <label className={labelClass}>WORKSPACE PATH (OPTIONAL)</label>
                    <input
                      type="text"
                      value={agentWorkspacePath}
                      onChange={(e) => setAgentWorkspacePath(e.target.value)}
                      placeholder="/path/to/project"
                      className={inputClass}
                    />
                  </div>
                )}

                {GATEWAY_ADAPTERS.includes(agentAdapterType) && (
                  <>
                    <div className="col-span-2">
                      <label className={labelClass}>GATEWAY URL</label>
                      <input
                        type="text"
                        value={agentGatewayUrl}
                        onChange={(e) => setAgentGatewayUrl(e.target.value)}
                        placeholder="ws://127.0.0.1:18789"
                        className={inputClass}
                      />
                      <p className="mt-1 font-mono text-[11px] text-white/35">
                        WebSocket URL of the OpenClaw gateway
                      </p>
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass}>AUTH TOKEN (OPTIONAL)</label>
                      <div className="relative mt-1">
                        <input
                          type={agentGatewayTokenVisible ? "text" : "password"}
                          value={agentGatewayToken}
                          onChange={(e) => setAgentGatewayToken(e.target.value)}
                          placeholder="OpenClaw gateway token"
                          className={`${inputClass} mt-0 pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setAgentGatewayTokenVisible(!agentGatewayTokenVisible)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-white/35 transition-colors hover:text-white/60"
                        >
                          {agentGatewayTokenVisible ? "HIDE" : "SHOW"}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {HTTP_ADAPTERS.includes(agentAdapterType) && (
                  <>
                    <div className="col-span-2">
                      <label className={labelClass}>API URL</label>
                      <input
                        type="text"
                        value={agentHttpUrl}
                        onChange={(e) => setAgentHttpUrl(e.target.value)}
                        placeholder="https://api.example.com/agent"
                        className={inputClass}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={labelClass}>AUTHORIZATION HEADER (OPTIONAL)</label>
                      <div className="relative mt-1">
                        <input
                          type={agentHttpAuthVisible ? "text" : "password"}
                          value={agentHttpAuth}
                          onChange={(e) => setAgentHttpAuth(e.target.value)}
                          placeholder="Bearer sk-..."
                          className={`${inputClass} mt-0 pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setAgentHttpAuthVisible(!agentHttpAuthVisible)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-white/35 transition-colors hover:text-white/60"
                        >
                          {agentHttpAuthVisible ? "HIDE" : "SHOW"}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className={labelClass}>EMOJI</label>
                  <input
                    type="text"
                    value={agentEmoji}
                    onChange={(e) => setAgentEmoji(e.target.value)}
                    placeholder="\u{1F916}"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>COLOR</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={agentColor}
                      onChange={(e) => setAgentColor(e.target.value)}
                      className="h-[42px] w-10 cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.03]"
                    />
                    <input
                      type="text"
                      value={agentColor}
                      onChange={(e) => setAgentColor(e.target.value)}
                      placeholder="#00f0ff"
                      className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded-lg border border-white/[0.08] px-4 py-2.5 font-mono text-xs tracking-wider text-white/40 transition-colors hover:bg-white/[0.04]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleCreateAgent}
                  disabled={loading || !agentName.trim()}
                  className="flex-1 rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
                >
                  {loading ? "CREATING..." : "CREATE AGENT"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Invite Members */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">INVITE YOUR TEAM</h2>
                <p className="mt-1 font-mono text-[11px] text-white/35">
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
                      className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                    />
                    {invites.length > 1 && (
                      <button
                        onClick={() => setInvites(invites.filter((_, j) => j !== i))}
                        className="rounded-lg border border-white/[0.06] px-3 font-mono text-xs text-white/35 hover:text-white/50"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setInvites([...invites, ""])}
                  className="font-mono text-[11px] text-neo/60 transition-colors hover:text-neo"
                >
                  + ADD ANOTHER
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 rounded-lg border border-white/[0.08] px-4 py-2.5 font-mono text-xs tracking-wider text-white/40 transition-colors hover:bg-white/[0.04]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleInviteMembers}
                  disabled={loading || invites.every((u) => !u.trim())}
                  className="flex-1 rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
                >
                  {loading ? "INVITING..." : "INVITE & CONTINUE"}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: First Goal */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">DEFINE YOUR FIRST GOAL</h2>
                <p className="mt-1 font-mono text-[11px] text-white/35">
                  Goals drive everything — tasks trace back to goals, goals trace back to mission.
                </p>
              </div>

              <div>
                <label className={labelClass}>GOAL TITLE</label>
                <input
                  type="text"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="e.g., Launch v1.0 of the platform"
                  className={inputClass}
                  autoFocus
                />
              </div>

              <div>
                <label className={labelClass}>DESCRIPTION (OPTIONAL)</label>
                <textarea
                  value={goalDescription}
                  onChange={(e) => setGoalDescription(e.target.value)}
                  rows={2}
                  placeholder="What does success look like?"
                  className={inputClass}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => router.push("/dashboard")}
                  className="flex-1 rounded-lg border border-white/[0.08] px-4 py-2.5 font-mono text-xs tracking-wider text-white/40 transition-colors hover:bg-white/[0.04]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleCreateGoal}
                  disabled={loading}
                  className="flex-1 rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
                >
                  {loading ? "FINISHING..." : goalTitle.trim() ? "CREATE & FINISH" : "FINISH SETUP"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
