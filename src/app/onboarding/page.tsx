"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AgentConfigFields,
  AgentConfigValues,
  defaultAgentConfigValues,
  nameToCallsign,
  ROLES,
  GATEWAY_ADAPTERS,
  HTTP_ADAPTERS,
} from "@/components/agent-config-fields";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Company
  const [companyName, setCompanyName] = useState("");
  const [companyMission, setCompanyMission] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);

  // Step 2: Agent
  const [agentValues, setAgentValues] = useState<AgentConfigValues>(defaultAgentConfigValues());
  const [callsignManual, setCallsignManual] = useState(false);
  const [existingAgents, setExistingAgents] = useState<{ id: string; name: string; callsign: string }[]>([]);

  // Step 3: Invite
  const [invites, setInvites] = useState<string[]>([""]);

  // Step 4: Goal
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");

  // Fetch existing agents when we reach step 2
  useEffect(() => {
    if (step === 2) {
      fetch("/api/agents")
        .then((r) => r.json())
        .then((data) => {
          if (data.agents) {
            setExistingAgents(data.agents.map((a: { id: string; name: string; callsign: string }) => ({
              id: a.id,
              name: a.name,
              callsign: a.callsign,
            })));
          }
        })
        .catch(() => {});
    }
  }, [step]);

  const handleAgentChange = useCallback(
    (patch: Partial<AgentConfigValues>) => {
      setAgentValues((prev) => {
        const next = { ...prev, ...patch };
        if ("name" in patch && !callsignManual) {
          next.callsign = nameToCallsign(patch.name ?? "");
        }
        if ("callsign" in patch && !("name" in patch)) {
          setCallsignManual(true);
        }
        return next;
      });
    },
    [callsignManual]
  );

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
    if (!agentValues.name.trim() || !companyId) return;
    setLoading(true);

    try {
      const callsign = agentValues.callsign.trim() || nameToCallsign(agentValues.name);
      const adapterConfig: Record<string, unknown> = {};
      if (GATEWAY_ADAPTERS.includes(agentValues.adapterType)) {
        if (agentValues.gatewayUrl.trim()) adapterConfig.url = agentValues.gatewayUrl.trim();
        if (agentValues.gatewayToken.trim()) {
          adapterConfig.headers = { "x-openclaw-token": agentValues.gatewayToken.trim() };
        }
      } else if (HTTP_ADAPTERS.includes(agentValues.adapterType)) {
        if (agentValues.httpUrl.trim()) adapterConfig.url = agentValues.httpUrl.trim();
        if (agentValues.httpAuthHeader.trim()) {
          adapterConfig.headers = { Authorization: agentValues.httpAuthHeader.trim() };
        }
      }
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentValues.name.trim(),
          callsign,
          title: ROLES.find((r) => r.value === agentValues.role)?.label || "Agent",
          emoji: agentValues.emoji || "\u{1F916}",
          color: agentValues.color || "#00f0ff",
          adapterType: agentValues.adapterType,
          adapterConfig,
          role: agentValues.role,
          model: agentValues.model.trim() || null,
          workspacePath: agentValues.workspacePath.trim() || null,
          reportsTo: agentValues.reportsTo || null,
          companyId,
          // Extended fields
          command: agentValues.command.trim() || null,
          thinkingEffort: agentValues.thinkingEffort || null,
          promptTemplate: agentValues.promptTemplate.trim() || null,
          instructionsFile: agentValues.instructionsFile.trim() || null,
          extraArgs: agentValues.extraArgs.trim() || null,
          envVars: Object.keys(agentValues.envVars).length > 0 ? agentValues.envVars : null,
          timeoutSec: agentValues.timeoutSec,
          gracePeriodSec: agentValues.gracePeriodSec,
          heartbeatEnabled: agentValues.heartbeatEnabled,
          heartbeatIntervalSec: agentValues.heartbeatIntervalSec,
          wakeOnDemand: agentValues.wakeOnDemand,
          cooldownSec: agentValues.cooldownSec,
          maxConcurrentRuns: agentValues.maxConcurrentRuns,
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
  );

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50";
  const labelClass = "block text-[11px] tracking-wider text-[var(--text-tertiary)]";

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <h1 className="font-mono text-xl font-bold tracking-wider text-[var(--accent)]">WELCOME TO CREWCMD</h1>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            Let&apos;s set up your crew in a few quick steps.
          </p>
        </div>

        <div className="mt-6">{stepIndicator}</div>

        <div className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          {/* Step 1: Create Company */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">CREATE YOUR COMPANY</h2>
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
                className="w-full rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
              >
                {loading ? "CREATING..." : "CREATE COMPANY"}
              </button>
            </div>
          )}

          {/* Step 2: Create First Agent */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">CREATE YOUR FIRST AGENT</h2>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  Add an AI agent to your crew. You can add more later.
                </p>
              </div>

              <div className="max-h-[50vh] overflow-y-auto">
                <AgentConfigFields
                  values={agentValues}
                  onChange={handleAgentChange}
                  existingAgents={existingAgents}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleCreateAgent}
                  disabled={loading || !agentValues.name.trim()}
                  className="flex-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
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
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">INVITE YOUR TEAM</h2>
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
                      className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
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
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleInviteMembers}
                  disabled={loading || invites.every((u) => !u.trim())}
                  className="flex-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
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
                <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">DEFINE YOUR FIRST GOAL</h2>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
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
                  className="flex-1 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  SKIP
                </button>
                <button
                  onClick={handleCreateGoal}
                  disabled={loading}
                  className="flex-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
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
