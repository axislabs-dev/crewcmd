"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AgentConfigFields,
  AgentConfigValues,
  defaultAgentConfigValues,
  nameToCallsign,
  ROLES,
  GATEWAY_ADAPTERS,
  HTTP_ADAPTERS,
} from "./agent-config-fields";

interface NewAgentDialogProps {
  companyId: string | null;
  onCreated: () => void;
  onClose: () => void;
}

export function NewAgentDialog({ companyId, onCreated, onClose }: NewAgentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<AgentConfigValues>(defaultAgentConfigValues());
  const [callsignManual, setCallsignManual] = useState(false);
  const [existingAgents, setExistingAgents] = useState<{ id: string; name: string; callsign: string }[]>([]);

  // Fetch existing agents for reports-to picker
  useEffect(() => {
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
  }, []);

  const handleChange = useCallback(
    (patch: Partial<AgentConfigValues>) => {
      setValues((prev) => {
        const next = { ...prev, ...patch };
        // Auto-generate callsign from name when not manually edited
        if ("name" in patch && !callsignManual) {
          next.callsign = nameToCallsign(patch.name ?? "");
        }
        // Detect manual callsign editing
        if ("callsign" in patch && !("name" in patch)) {
          setCallsignManual(true);
        }
        return next;
      });
    },
    [callsignManual]
  );

  async function handleSubmit() {
    if (!values.name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const callsign = (values.callsign.trim() || nameToCallsign(values.name)).toUpperCase();

      // Build adapter config based on type
      const adapterConfig: Record<string, unknown> = {};
      if (GATEWAY_ADAPTERS.includes(values.adapterType)) {
        if (values.gatewayUrl.trim()) adapterConfig.url = values.gatewayUrl.trim();
        if (values.gatewayToken.trim()) {
          adapterConfig.headers = { "x-openclaw-token": values.gatewayToken.trim() };
        }
      } else if (HTTP_ADAPTERS.includes(values.adapterType)) {
        if (values.httpUrl.trim()) adapterConfig.url = values.httpUrl.trim();
        if (values.httpAuthHeader.trim()) {
          adapterConfig.headers = { Authorization: values.httpAuthHeader.trim() };
        }
      }

      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          callsign,
          title: ROLES.find((r) => r.value === values.role)?.label || "Agent",
          emoji: values.emoji || "\u{1F916}",
          color: values.color || "#00f0ff",
          adapterType: values.adapterType,
          adapterConfig,
          role: values.role,
          model: values.model.trim() || null,
          workspacePath: values.workspacePath.trim() || null,
          reportsTo: values.reportsTo || null,
          companyId,
          // Extended fields
          command: values.command.trim() || null,
          thinkingEffort: values.thinkingEffort || null,
          promptTemplate: values.promptTemplate.trim() || null,
          instructionsFile: values.instructionsFile.trim() || null,
          extraArgs: values.extraArgs.trim() || null,
          envVars: Object.keys(values.envVars).length > 0 ? values.envVars : null,
          timeoutSec: values.timeoutSec,
          gracePeriodSec: values.gracePeriodSec,
          heartbeatEnabled: values.heartbeatEnabled,
          heartbeatIntervalSec: values.heartbeatIntervalSec,
          wakeOnDemand: values.wakeOnDemand,
          cooldownSec: values.cooldownSec,
          maxConcurrentRuns: values.maxConcurrentRuns,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-white/[0.08] bg-[#0a0a0f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h2 className="font-mono text-sm font-bold tracking-wider text-white/70">NEW AGENT</h2>
          <button
            onClick={onClose}
            className="font-mono text-xs text-white/35 transition-colors hover:text-white/60"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">
              {error}
            </div>
          )}

          <AgentConfigFields
            values={values}
            onChange={handleChange}
            existingAgents={existingAgents}
          />
        </div>

        <div className="flex gap-2 border-t border-white/[0.06] px-6 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-white/[0.08] px-4 py-2.5 font-mono text-xs tracking-wider text-white/40 transition-colors hover:bg-white/[0.04]"
          >
            CANCEL
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !values.name.trim()}
            className="flex-1 rounded-lg bg-neo/20 px-4 py-2.5 font-mono text-xs tracking-wider text-neo transition-colors hover:bg-neo/30 disabled:opacity-50"
          >
            {loading ? "CREATING..." : "CREATE AGENT"}
          </button>
        </div>
      </div>
    </div>
  );
}
