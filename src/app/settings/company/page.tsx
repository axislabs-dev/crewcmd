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

interface ProviderKey {
  id: string;
  provider: string;
  label: string | null;
  maskedKey: string;
  createdAt: string;
  updatedAt: string;
}

const PROVIDER_INFO: Record<string, { label: string; placeholder: string }> = {
  anthropic: { label: "Anthropic", placeholder: "sk-ant-..." },
  openai: { label: "OpenAI", placeholder: "sk-..." },
  google: { label: "Google", placeholder: "AIza..." },
  openrouter: { label: "OpenRouter", placeholder: "sk-or-v1-..." },
};

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

  // Provider keys state
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [newKeyProvider, setNewKeyProvider] = useState("anthropic");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);

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
      const [companyRes, membersRes, keysRes] = await Promise.all([
        fetch(`/api/companies/${companyId}`),
        fetch(`/api/companies/${companyId}/members`),
        fetch(`/api/provider-keys?companyId=${companyId}`),
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

      if (keysRes.ok) {
        const data = await keysRes.json();
        setProviderKeys(data.keys ?? []);
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

  async function handleAddKey() {
    if (!company || !newKeyValue.trim()) return;
    setSavingKey(true);
    setMessage(null);

    try {
      const res = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          provider: newKeyProvider,
          apiKey: newKeyValue.trim(),
        }),
      });

      if (res.ok) {
        setNewKeyValue("");
        setMessage({ type: "success", text: `${PROVIDER_INFO[newKeyProvider]?.label ?? newKeyProvider} key saved` });
        fetchData();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save key" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSavingKey(false);
    }
  }

  async function handleDeleteKey(keyId: string) {
    if (!company) return;
    try {
      await fetch(`/api/provider-keys?id=${keyId}`, { method: "DELETE" });
      fetchData();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--text-tertiary)]">No company selected</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
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
      <h1 className="font-mono text-lg font-bold tracking-wider text-[var(--accent)]">COMPANY SETTINGS</h1>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">Manage your company profile and team members</p>

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
      <div className="mt-6 space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-xs font-bold tracking-wider text-[var(--text-secondary)]">COMPANY INFO</h2>

        <div>
          <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">NAME</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
          />
        </div>

        <div>
          <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">MISSION</label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
            placeholder="What's your company's mission?"
          />
        </div>

        <div>
          <label className="block text-[10px] tracking-wider text-[var(--text-tertiary)]">LOGO URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
            placeholder="https://..."
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
        >
          {saving ? "SAVING..." : "SAVE CHANGES"}
        </button>
      </div>

      {/* Members */}
      <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-xs font-bold tracking-wider text-[var(--text-secondary)]">TEAM MEMBERS</h2>

        {/* Invite form */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
            placeholder="GitHub username"
            className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteUsername.trim()}
            className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
          >
            {inviting ? "..." : "INVITE"}
          </button>
        </div>

        {/* Member list */}
        <div className="mt-4 space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-surface-hover)] font-mono text-xs text-[var(--text-secondary)]">
                  {m.githubUsername[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-mono text-xs text-[var(--text-primary)]">{m.githubUsername}</p>
                  {m.email && (
                    <p className="font-mono text-[10px] text-[var(--text-tertiary)]">{m.email}</p>
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
            <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">No members yet</p>
          )}
        </div>
      </div>

      {/* Provider API Keys */}
      <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-xs font-bold tracking-wider text-[var(--text-secondary)]">PROVIDER API KEYS</h2>
        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          Add API keys for AI providers. Keys are encrypted at rest and never exposed in full.
        </p>

        {/* Existing keys */}
        <div className="mt-4 space-y-2">
          {providerKeys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-[var(--accent)]">
                  {PROVIDER_INFO[k.provider]?.label?.toUpperCase() ?? k.provider.toUpperCase()}
                </span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">{k.maskedKey}</span>
                {k.label && (
                  <span className="text-[10px] text-[var(--text-tertiary)]">{k.label}</span>
                )}
              </div>
              <button
                onClick={() => handleDeleteKey(k.id)}
                className="font-mono text-[10px] text-red-400/60 transition-colors hover:text-red-400"
              >
                REMOVE
              </button>
            </div>
          ))}
          {providerKeys.length === 0 && (
            <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">No API keys configured</p>
          )}
        </div>

        {/* Add new key */}
        <div className="mt-4 flex gap-2">
          <select
            value={newKeyProvider}
            onChange={(e) => setNewKeyProvider(e.target.value)}
            className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none"
          >
            {Object.entries(PROVIDER_INFO).map(([key, info]) => (
              <option key={key} value={key}>
                {info.label}
              </option>
            ))}
          </select>
          <input
            type="password"
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder={PROVIDER_INFO[newKeyProvider]?.placeholder ?? "API key"}
            className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-neo/50"
          />
          <button
            onClick={handleAddKey}
            disabled={savingKey || !newKeyValue.trim()}
            className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
          >
            {savingKey ? "..." : "ADD KEY"}
          </button>
        </div>
      </div>
    </div>
  );
}
