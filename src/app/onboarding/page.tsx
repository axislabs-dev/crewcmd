"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Company
  const [companyName, setCompanyName] = useState("");
  const [companyMission, setCompanyMission] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);

  // Step 2: Invite
  const [invites, setInvites] = useState<string[]>([""]);

  // Step 3: Goal
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
        // Set active company cookie
        document.cookie = `active_company=${company.id};path=/;max-age=${60 * 60 * 24 * 365}`;
        setStep(2);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
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
      setStep(3);
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

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3].map((s) => (
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
          {s < 3 && (
            <div className={`h-px w-8 ${s < step ? "bg-emerald-500/30" : "bg-white/[0.06]"}`} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <h1 className="font-mono text-xl font-bold tracking-wider text-neo">WELCOME TO CREWCMD</h1>
          <p className="mt-2 font-mono text-xs text-white/30">
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
                <p className="mt-1 font-mono text-[10px] text-white/30">
                  This is your organization — the home for your agent crew.
                </p>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">COMPANY NAME</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g., Acme Corp"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">MISSION (OPTIONAL)</label>
                <textarea
                  value={companyMission}
                  onChange={(e) => setCompanyMission(e.target.value)}
                  rows={2}
                  placeholder="What's your crew working towards?"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
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

          {/* Step 2: Invite Members */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">INVITE YOUR TEAM</h2>
                <p className="mt-1 font-mono text-[10px] text-white/30">
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
                        className="rounded-lg border border-white/[0.06] px-3 font-mono text-xs text-white/30 hover:text-white/50"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setInvites([...invites, ""])}
                  className="font-mono text-[10px] text-neo/60 transition-colors hover:text-neo"
                >
                  + ADD ANOTHER
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
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

          {/* Step 3: First Goal */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">DEFINE YOUR FIRST GOAL</h2>
                <p className="mt-1 font-mono text-[10px] text-white/30">
                  Goals drive everything — tasks trace back to goals, goals trace back to mission.
                </p>
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">GOAL TITLE</label>
                <input
                  type="text"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="e.g., Launch v1.0 of the platform"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-wider text-white/40">DESCRIPTION (OPTIONAL)</label>
                <textarea
                  value={goalDescription}
                  onChange={(e) => setGoalDescription(e.target.value)}
                  rows={2}
                  placeholder="What does success look like?"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
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
