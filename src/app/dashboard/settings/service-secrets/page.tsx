"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompany } from "@/components/company-context";

interface SecretMetadata {
  id: string;
  name: string;
  description: string | null;
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = {
  id: "",
  name: "",
  description: "",
  value: "",
};

export default function ServiceSecretsPage() {
  const { company, loading: companyLoading } = useCompany();
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(emptyForm);

  const isEditing = Boolean(form.id);

  const sortedSecrets = useMemo(
    () => [...secrets].sort((a, b) => a.name.localeCompare(b.name)),
    [secrets]
  );

  const loadSecrets = useCallback(async () => {
    if (!company?.id) {
      setSecrets([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/service-secrets?companyId=${company.id}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load secrets");
        setSecrets([]);
        return;
      }

      setSecrets(Array.isArray(data.secrets) ? data.secrets : []);
    } catch {
      setError("Failed to load secrets");
      setSecrets([]);
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    loadSecrets();
  }, [loadSecrets]);

  const resetForm = () => {
    setForm(emptyForm);
    setError("");
    setSuccess("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company?.id) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        companyId: company.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        value: form.value,
      };

      const res = await fetch(
        isEditing ? `/api/service-secrets/${form.id}` : "/api/service-secrets",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isEditing ? { name: payload.name, description: payload.description, value: payload.value } : payload),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save secret");
        return;
      }

      setSuccess(isEditing ? "Secret updated." : "Secret saved.");
      resetForm();
      await loadSecrets();
    } catch {
      setError("Failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (secret: SecretMetadata) => {
    setForm({
      id: secret.id,
      name: secret.name,
      description: secret.description || "",
      value: "",
    });
    setError("");
    setSuccess(`Editing ${secret.name}. Enter a new value to rotate it.`);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.3em] text-[var(--text-tertiary)]">
            SETTINGS / VAULT
          </p>
          <h1 className="mt-2 text-xl font-bold tracking-wider text-[var(--text-primary)]">
            SERVICE SECRETS
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-tertiary)]">
            Manage company-level secrets that can be referenced by skills and agent config via <code className="rounded bg-[var(--bg-surface)] px-1 py-0.5 text-xs">secretRef</code>.
          </p>
        </div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center justify-center rounded-lg border border-[var(--border-medium)] px-4 py-2 text-xs font-semibold tracking-wider text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
        >
          BACK TO SETTINGS
        </Link>
      </div>

      {!companyLoading && !company && (
        <div className="glass-card rounded-2xl p-6 text-sm text-amber-300" style={{ borderColor: "rgba(251, 191, 36, 0.18)" }}>
          Select or create a company first. Secrets are stored per company.
        </div>
      )}

      {company && (
        <div className="mb-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-4 py-3 text-sm text-[var(--text-secondary)]">
          Active company: <span className="font-semibold text-[var(--text-primary)]">{company.name}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="glass-card rounded-2xl p-6" style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">SAVED SECRETS</h2>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">Values stay masked. Updating a secret writes a new value without exposing the old one.</p>
            </div>
            <button
              type="button"
              onClick={loadSecrets}
              className="rounded-lg border border-[var(--border-medium)] px-3 py-2 text-[10px] font-semibold tracking-wider text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
            >
              REFRESH
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--text-tertiary)]">Loading secrets...</p>
          ) : sortedSecrets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-medium)] px-4 py-6 text-sm text-[var(--text-tertiary)]">
              No service secrets yet. Create one on the right to get started.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-surface)]/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] tracking-wider text-[var(--text-tertiary)]">NAME</th>
                    <th className="px-4 py-3 text-left text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</th>
                    <th className="px-4 py-3 text-left text-[10px] tracking-wider text-[var(--text-tertiary)]">VALUE</th>
                    <th className="px-4 py-3 text-left text-[10px] tracking-wider text-[var(--text-tertiary)]">UPDATED</th>
                    <th className="px-4 py-3 text-right text-[10px] tracking-wider text-[var(--text-tertiary)]">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSecrets.map((secret) => (
                    <tr key={secret.id} className="border-t border-[var(--border-subtle)] align-top">
                      <td className="px-4 py-3 font-mono text-[var(--text-primary)]">{secret.name}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{secret.description || "—"}</td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{secret.maskedValue}</td>
                      <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(secret.updatedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(secret)}
                          className="rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-3 py-2 text-[10px] font-semibold tracking-wider text-[var(--accent)] transition hover:opacity-90"
                        >
                          EDIT / ROTATE
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass-card rounded-2xl p-6" style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}>
          <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
            {isEditing ? "UPDATE SECRET" : "ADD SECRET"}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Use stable names like <span className="font-mono">openai_api_key</span> or <span className="font-mono">n8n_webhook_secret</span>.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">SECRET NAME</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="openai_api_key"
                required
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION (OPTIONAL)</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                placeholder="Used by the OpenAI-backed content skill"
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">
                {isEditing ? "NEW VALUE" : "VALUE"}
              </label>
              <input
                type="password"
                value={form.value}
                onChange={(e) => setForm((current) => ({ ...current, value: e.target.value }))}
                placeholder={isEditing ? "Enter replacement secret value" : "Paste secret value"}
                required
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-neo/40 focus:outline-none"
              />
              {isEditing && (
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  Existing values are never shown again. Entering a value here rotates the secret.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {success && <p className="text-sm text-emerald-400">{success}</p>}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving || !company}
                className="rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-5 py-2 text-xs font-bold tracking-wider text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                {saving ? "SAVING..." : isEditing ? "UPDATE SECRET" : "SAVE SECRET"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-[var(--border-medium)] px-5 py-2 text-xs font-bold tracking-wider text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
              >
                CLEAR
              </button>
            </div>
          </form>

          <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 text-xs text-[var(--text-tertiary)]">
            <p className="font-semibold tracking-wider text-[var(--text-secondary)]">HOW TO REFERENCE IN CONFIG</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/20 p-3 font-mono text-[11px] text-[var(--text-secondary)]">{`{
  "apiKey": {
    "secretRef": {
      "name": "openai_api_key"
    }
  }
}`}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}
