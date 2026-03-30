"use client";

import { useState, useEffect, useCallback } from "react";

interface Company {
  id: string;
  name: string;
  mission: string | null;
  logoUrl: string | null;
}

interface Member {
  id: string;
  userId: string;
  role: string;
  githubUsername: string;
  email: string | null;
  createdAt: string;
}

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const getActiveCompanyId = () => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("active_company="));
    return cookie?.split("=")[1] ?? null;
  };

  const fetchData = useCallback(async () => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setLoading(false);
      return;
    }

    try {
      const [companyRes, membersRes] = await Promise.all([
        fetch(`/api/companies/${companyId}`),
        fetch(`/api/companies/${companyId}/members`),
      ]);

      if (companyRes.ok) {
        const data = await companyRes.json();
        setCompany(data);
        setName(data.name);
        setMission(data.mission || "");
        setLogoUrl(data.logoUrl || "");
      }

      if (membersRes.ok) {
        setMembers(await membersRes.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSave() {
    if (!company) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mission: mission || null, logoUrl: logoUrl || null }),
      });

      if (res.ok) {
        const updated = await res.json();
        setCompany(updated);
        setMessage({ type: "success", text: "Company updated" });
      } else {
        setMessage({ type: "error", text: "Failed to update" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite() {
    if (!company || !inviteUsername.trim()) return;
    setInviting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/companies/${company.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: inviteUsername.trim(),
          role: inviteRole,
        }),
      });

      if (res.ok) {
        setInviteUsername("");
        setMessage({ type: "success", text: `Invited ${inviteUsername.trim()}` });
        fetchData();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to invite" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!company) return;
    try {
      await fetch(`/api/companies/${company.id}/members?memberId=${memberId}`, {
        method: "DELETE",
      });
      fetchData();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="font-mono text-sm text-white/30">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-sm text-white/40">No company selected</p>
          <p className="mt-1 font-mono text-xs text-white/25">
            Select a company from the sidebar or create one in the onboarding flow.
          </p>
        </div>
      </div>
    );
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-amber-500/20 text-amber-400",
      admin: "bg-blue-500/20 text-blue-400",
      member: "bg-emerald-500/20 text-emerald-400",
      viewer: "bg-gray-500/20 text-gray-400",
    };
    return (
      <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${colors[role] || colors.viewer}`}>
        {role.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-mono text-lg font-bold tracking-wider text-neo">COMPANY SETTINGS</h1>
      <p className="mt-1 font-mono text-xs text-white/30">Manage your company profile and team members</p>

      {message && (
        <div
          className={`mt-4 rounded-lg border px-4 py-2 font-mono text-xs ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Company Info */}
      <div className="mt-6 space-y-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">COMPANY INFO</h2>

        <div>
          <label className="block font-mono text-[10px] tracking-wider text-white/40">NAME</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
          />
        </div>

        <div>
          <label className="block font-mono text-[10px] tracking-wider text-white/40">MISSION</label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
            placeholder="What's your company's mission?"
          />
        </div>

        <div>
          <label className="block font-mono text-[10px] tracking-wider text-white/40">LOGO URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
            placeholder="https://..."
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
        >
          {saving ? "SAVING..." : "SAVE CHANGES"}
        </button>
      </div>

      {/* Members */}
      <div className="mt-6 rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="font-mono text-xs font-bold tracking-wider text-white/50">TEAM MEMBERS</h2>

        {/* Invite form */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
            placeholder="GitHub username"
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 outline-none transition-colors focus:border-neo/50"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white/60 outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteUsername.trim()}
            className="rounded-lg bg-neo/20 px-4 py-2 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
          >
            {inviting ? "..." : "INVITE"}
          </button>
        </div>

        {/* Member list */}
        <div className="mt-4 space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.01] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] font-mono text-xs text-white/50">
                  {m.githubUsername[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-mono text-xs text-white/70">{m.githubUsername}</p>
                  {m.email && (
                    <p className="font-mono text-[10px] text-white/30">{m.email}</p>
                  )}
                </div>
                {roleBadge(m.role)}
              </div>
              {m.role !== "owner" && (
                <button
                  onClick={() => handleRemoveMember(m.id)}
                  className="font-mono text-[10px] text-red-400/60 transition-colors hover:text-red-400"
                >
                  REMOVE
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="py-4 text-center font-mono text-xs text-white/25">No members yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
