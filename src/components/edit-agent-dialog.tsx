"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AgentConfigFields,
  AgentConfigValues,
  defaultAgentConfigValues,
  ROLES,
  GATEWAY_ADAPTERS,
  HTTP_ADAPTERS,
  OPENROUTER_ADAPTERS,
} from "./agent-config-fields";

interface EditAgentDialogProps {
  callsign: string;
  companyId: string | null;
  onSaved: () => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function EditAgentDialog({ callsign, companyId, onSaved, onClose, onDelete }: EditAgentDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<AgentConfigValues>(defaultAgentConfigValues());
  const [existingAgents, setExistingAgents] = useState<{ id: string; name: string; callsign: string }[]>([]);

  // Load agent data + existing agents
  useEffect(() => {
    Promise.all([
      fetch(`/api/agents/${callsign}`).then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
    ])
      .then(([agent, agentList]) => {
        if (agent.error) {
          setError("Agent not found");
          setLoading(false);
          return;
        }

        const adapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
        const runtimeConfig = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
        const heartbeat = (runtimeConfig.heartbeat ?? {}) as Record<string, unknown>;

        setValues({
          name: agent.name ?? "",
          callsign: agent.callsign ?? "",
          role: agent.role ?? "engineer",
          adapterType: agent.adapterType ?? "claude_local",
          provider: agent.provider ?? "",
          model: agent.model ?? "",
          workspacePath: agent.workspacePath ?? "",
          emoji: agent.emoji ?? "🤖",
          color: agent.color ?? "#00f0ff",
          command: (adapterConfig.command as string) ?? "",
          thinkingEffort: (adapterConfig.thinkingEffort as string) ?? "",
          promptTemplate: (adapterConfig.promptTemplate as string) ?? "",
          instructionsFile: (adapterConfig.instructionsFile as string) ?? "",
          extraArgs: (adapterConfig.extraArgs as string) ?? "",
          envVars: (adapterConfig.envVars as Record<string, string>) ?? {},
          heartbeatEnabled: (heartbeat.enabled as boolean) ?? false,
          heartbeatIntervalSec: (heartbeat.intervalSec as number) ?? 300,
          wakeOnDemand: (heartbeat.wakeOnDemand as boolean) ?? true,
          cooldownSec: (heartbeat.cooldownSec as number) ?? 60,
          maxConcurrentRuns: (heartbeat.maxConcurrentRuns as number) ?? 1,
          timeoutSec: (adapterConfig.timeoutSec as number) ?? 600,
          gracePeriodSec: (adapterConfig.gracePeriodSec as number) ?? 30,
          reportsTo: agent.reportsTo ?? "",
          gatewayUrl: GATEWAY_ADAPTERS.includes(agent.adapterType) ? (adapterConfig.url as string) ?? "" : "",
          gatewayToken: "",
          httpUrl: HTTP_ADAPTERS.includes(agent.adapterType) ? (adapterConfig.url as string) ?? "" : "",
          httpAuthHeader: "",
          openrouterApiKey: "",
          openrouterBaseUrl: OPENROUTER_ADAPTERS.includes(agent.adapterType) ? (adapterConfig.baseUrl as string) ?? "" : "",
          skillIds: [],
        });

        // Fetch skills for this agent
        fetch(`/api/agents/${callsign.toLowerCase()}/skills`)
          .then((r) => r.json())
          .then((rows) => {
            if (Array.isArray(rows)) {
              const ids = rows.map((r: { skillId?: string }) => r.skillId).filter(Boolean) as string[];
              setValues((prev) => ({ ...prev, skillIds: ids }));
            }
          })
          .catch(() => {});

        if (agentList.agents) {
          setExistingAgents(
            agentList.agents
              .filter((a: { callsign: string }) => a.callsign.toLowerCase() !== callsign.toLowerCase())
              .map((a: { id: string; name: string; callsign: string }) => ({
                id: a.id,
                name: a.name,
                callsign: a.callsign,
              }))
          );
        }

        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load agent");
        setLoading(false);
      });
  }, [callsign]);

  const handleChange = useCallback((patch: Partial<AgentConfigValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const adapterConfig: Record<string, unknown> = {};
      if (values.command) adapterConfig.command = values.command;
      if (values.thinkingEffort) adapterConfig.thinkingEffort = values.thinkingEffort;
      if (values.promptTemplate) adapterConfig.promptTemplate = values.promptTemplate;
      if (values.instructionsFile) adapterConfig.instructionsFile = values.instructionsFile;
      if (values.extraArgs) adapterConfig.extraArgs = values.extraArgs;
      if (Object.keys(values.envVars).length > 0) adapterConfig.envVars = values.envVars;
      adapterConfig.timeoutSec = values.timeoutSec;
      adapterConfig.gracePeriodSec = values.gracePeriodSec;

      if (GATEWAY_ADAPTERS.includes(values.adapterType)) {
        if (values.gatewayUrl) adapterConfig.url = values.gatewayUrl;
        if (values.gatewayToken) {
          adapterConfig.headers = { "x-openclaw-token": values.gatewayToken };
        }
      } else if (HTTP_ADAPTERS.includes(values.adapterType)) {
        if (values.httpUrl) adapterConfig.url = values.httpUrl;
        if (values.httpAuthHeader) {
          adapterConfig.headers = { Authorization: values.httpAuthHeader };
        }
      } else if (OPENROUTER_ADAPTERS.includes(values.adapterType)) {
        if (values.openrouterApiKey) adapterConfig.apiKey = values.openrouterApiKey;
        if (values.openrouterBaseUrl) adapterConfig.baseUrl = values.openrouterBaseUrl;
      }

      const res = await fetch(`/api/agents/${callsign}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          callsign: values.callsign.trim().toUpperCase(),
          title: ROLES.find((r) => r.value === values.role)?.label || values.role || "Agent",
          emoji: values.emoji || "🤖",
          color: values.color || "#00f0ff",
          adapterType: values.adapterType,
          adapterConfig,
          provider: values.provider || null,
          role: values.role,
          model: values.model.trim() || null,
          workspacePath: values.workspacePath.trim() || null,
          reportsTo: values.reportsTo || null,
          heartbeatEnabled: values.heartbeatEnabled,
          heartbeatIntervalSec: values.heartbeatIntervalSec,
          wakeOnDemand: values.wakeOnDemand,
          cooldownSec: values.cooldownSec,
          maxConcurrentRuns: values.maxConcurrentRuns,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }

      // Update skills assignment
      if (values.skillIds.length > 0) {
        await fetch(`/api/agents/${callsign.toLowerCase()}/skills`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillIds: values.skillIds }),
        }).catch(() => {});
      }

      onSaved();
    } catch {
      setError("Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${callsign}`, { method: "DELETE" });
      if (res.ok) {
        onDelete?.();
        onClose();
      } else {
        setError("Failed to delete agent");
      }
    } catch {
      setError("Failed to delete agent");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
            EDIT AGENT — {callsign.toUpperCase()}
          </h2>
          <button
            onClick={onClose}
            className="text-lg text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}
              <AgentConfigFields
                values={values}
                onChange={handleChange}
                existingAgents={existingAgents}
                companyId={companyId}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
          {/* Delete zone */}
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this agent?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-500/20 px-3 py-2 text-xs tracking-wider text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? "DELETING..." : "YES, DELETE"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-[var(--border-medium)] px-3 py-2 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                CANCEL
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-red-500/20 px-3 py-2 text-xs tracking-wider text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              DELETE
            </button>
          )}

          <div className="flex-1" />

          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-xs tracking-wider text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !values.name.trim()}
            className="rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50"
          >
            {saving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>
    </div>
  );
}
