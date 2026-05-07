"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { resolveModelDefault, type ModelDefaultSource } from "@/lib/model-default-resolution";

interface RuntimeRecord {
  id: string;
  name: string;
  runtimeType: string;
  status: string;
  isPrimary: boolean;
  ownerType: "user" | "company";
  ownerCompanyId: string | null;
  capabilitySnapshot?: Record<string, unknown> | null;
}

interface RuntimeModel {
  runtimeId: string;
  provider: string;
  id: string;
  name: string;
}

interface RuntimeModelsState {
  loading: boolean;
  error: string | null;
  models: RuntimeModel[];
}

interface ModelProfile {
  id: string;
  label: string;
  providerPreferences: string[];
  supported: boolean;
  recommendedModel: string | null;
  fallbackModels: string[];
}

interface PersistedModelProfile {
  id: string;
  name: string;
  slug: string;
  primaryModel: string | null;
  fallbackModels: string[];
}

interface AgentRecord {
  id: string;
  callsign: string;
  name: string;
  title: string;
  status: string;
  model: string | null;
  provider: string | null;
  role: string | null;
  runtimeId: string | null;
  runtimeRef: string | null;
  ownerType: "user" | "company";
}

interface CompanyModelDefault {
  id: string;
  companyId: string;
  modelProfileId: string | null;
  model: string | null;
}

const cardClassName = "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]";
const inputClassName = "rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";
const buttonClassName = "rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60";

const sourceLabels: Record<ModelDefaultSource, string> = {
  agent_override: "Agent override",
  company_default: "Company default",
  runtime_default: "Runtime default",
  unresolved: "Unresolved",
};

export default function ModelsPage() {
  const [runtimes, setRuntimes] = useState<RuntimeRecord[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<Record<string, RuntimeModelsState>>({});
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [persistedProfiles, setPersistedProfiles] = useState<PersistedModelProfile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [companyDefault, setCompanyDefault] = useState<CompanyModelDefault | null>(null);
  const [companyDefaultError, setCompanyDefaultError] = useState<string | null>(null);
  const [defaultDraft, setDefaultDraft] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimes() {
      setLoadingRuntimes(true);
      setRuntimeError(null);

      try {
        const response = await fetch("/api/runtimes", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load runtimes");

        const rows = Array.isArray(data) ? data : [];
        if (cancelled) return;
        setRuntimes(rows);
        setSelectedRuntimeId((current) => current ?? rows[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) setRuntimeError(error instanceof Error ? error.message : "Failed to load runtimes");
      } finally {
        if (!cancelled) setLoadingRuntimes(false);
      }
    }

    void loadRuntimes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRuntimeId || runtimeModels[selectedRuntimeId]) return;

    let cancelled = false;

    async function loadModels(runtimeId: string) {
      setRuntimeModels((current) => ({ ...current, [runtimeId]: { loading: true, error: null, models: [] } }));

      try {
        const response = await fetch(`/api/runtimes/${runtimeId}/models`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to discover models");

        if (!cancelled) {
          setRuntimeModels((current) => ({
            ...current,
            [runtimeId]: { loading: false, error: null, models: Array.isArray(data.models) ? data.models : [] },
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeModels((current) => ({
            ...current,
            [runtimeId]: {
              loading: false,
              error: error instanceof Error ? error.message : "Failed to discover models",
              models: [],
            },
          }));
        }
      }
    }

    void loadModels(selectedRuntimeId);
    return () => {
      cancelled = true;
    };
  }, [runtimeModels, selectedRuntimeId]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles() {
      setProfilesError(null);

      try {
        const response = await fetch("/api/models/profiles", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load model profiles");

        if (!cancelled) {
          setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
          setPersistedProfiles(Array.isArray(data.persistedProfiles) ? data.persistedProfiles : []);
        }
      } catch (error) {
        if (!cancelled) setProfilesError(error instanceof Error ? error.message : "Failed to load model profiles");
      }
    }

    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      setAgentsError(null);
      try {
        const response = await fetch("/api/agents?includeDetached=true", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load agents");
        const rows = Array.isArray(data.agents) ? data.agents : [];
        if (!cancelled) {
          setAgents(rows);
          setAgentDrafts(Object.fromEntries(rows.map((agent: AgentRecord) => [agent.id, agent.model ?? ""])));
        }
      } catch (error) {
        if (!cancelled) setAgentsError(error instanceof Error ? error.message : "Failed to load agents");
      }
    }

    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === selectedRuntimeId) ?? null;
  const selectedModelsState = selectedRuntimeId ? runtimeModels[selectedRuntimeId] : null;
  const runtimeDefault = readDefaultModel(selectedRuntime?.capabilitySnapshot);
  const companyDefaultModel = companyDefault?.model ?? resolvePersistedProfileModel(companyDefault?.modelProfileId, persistedProfiles);

  useEffect(() => {
    if (selectedRuntime?.ownerType !== "company" || !selectedRuntime.ownerCompanyId) {
      setCompanyDefault(null);
      setDefaultDraft("");
      setCompanyDefaultError(null);
      return;
    }

    let cancelled = false;
    const companyId = selectedRuntime.ownerCompanyId;

    async function loadCompanyDefault() {
      setCompanyDefaultError(null);
      try {
        const response = await fetch(`/api/companies/${companyId}/model-default`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load company default");
        if (!cancelled) {
          setCompanyDefault(data.default ?? null);
          setDefaultDraft(data.default?.model ?? "");
        }
      } catch (error) {
        if (!cancelled) {
          setCompanyDefault(null);
          setDefaultDraft("");
          setCompanyDefaultError(error instanceof Error ? error.message : "Failed to load company default");
        }
      }
    }

    void loadCompanyDefault();
    return () => {
      cancelled = true;
    };
  }, [selectedRuntime?.ownerCompanyId, selectedRuntime?.ownerType]);

  const selectedAgents = useMemo(() => {
    return agents
      .filter((agent) => !selectedRuntimeId || agent.runtimeId === selectedRuntimeId)
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
  }, [agents, selectedRuntimeId]);

  const filteredModels = useMemo(() => {
    const search = query.trim().toLowerCase();
    const models = selectedModelsState?.models ?? [];
    if (!search) return models;

    return models.filter((model) =>
      [model.id, model.name, model.provider].some((value) => value.toLowerCase().includes(search))
    );
  }, [query, selectedModelsState?.models]);

  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of selectedModelsState?.models ?? []) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedModelsState?.models]);

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    return (selectedModelsState?.models ?? [])
      .map((model) => model.id)
      .filter((modelId) => {
        if (seen.has(modelId)) return false;
        seen.add(modelId);
        return true;
      });
  }, [selectedModelsState?.models]);

  const defaultResolution = resolveModelDefault({ companyDefault: companyDefaultModel, runtimeDefault });
  const runtimeModelIds = useMemo(() => new Set(modelOptions), [modelOptions]);

  async function saveCompanyDefault() {
    if (!selectedRuntime?.ownerCompanyId) return;
    setSavingDefault(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/companies/${selectedRuntime.ownerCompanyId}/model-default`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: defaultDraft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save company default");
      setCompanyDefault(data.default ?? null);
      setDefaultDraft(data.default?.model ?? "");
      setMessage({ type: "success", text: "Company model default saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save company default" });
    } finally {
      setSavingDefault(false);
    }
  }

  async function clearCompanyDefault() {
    if (!selectedRuntime?.ownerCompanyId) return;
    setSavingDefault(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/companies/${selectedRuntime.ownerCompanyId}/model-default`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to clear company default");
      setCompanyDefault(null);
      setDefaultDraft("");
      setMessage({ type: "success", text: "Company model default cleared." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to clear company default" });
    } finally {
      setSavingDefault(false);
    }
  }

  async function saveAgentOverride(agent: AgentRecord) {
    const model = (agentDrafts[agent.id] ?? "").trim();
    if (!model) return clearAgentOverride(agent);

    setSavingAgentId(agent.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.callsign)}/model-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save agent override");
      setAgents((current) => current.map((item) => (item.id === agent.id ? { ...item, model: data.model ?? model } : item)));
      setAgentDrafts((current) => ({ ...current, [agent.id]: data.model ?? model }));
      setMessage({ type: "success", text: `${agent.callsign} now uses ${data.model ?? model}.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save agent override" });
    } finally {
      setSavingAgentId(null);
    }
  }

  async function clearAgentOverride(agent: AgentRecord) {
    setSavingAgentId(agent.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.callsign)}/model-override`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to clear agent override");
      setAgents((current) => current.map((item) => (item.id === agent.id ? { ...item, model: null } : item)));
      setAgentDrafts((current) => ({ ...current, [agent.id]: "" }));
      setMessage({ type: "success", text: `${agent.callsign} now inherits the default model.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to clear agent override" });
    } finally {
      setSavingAgentId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-2 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Manage runtime catalogs, default model resolution, and per-agent overrides.
            </p>
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">Agent override → company default → runtime default</div>
        </header>

        {message ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-200" : "border-red-500/30 bg-red-950/30 text-red-200"}`}>
            {message.text}
          </div>
        ) : null}

        {runtimeError ? <ErrorBanner>{runtimeError}</ErrorBanner> : null}

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className={`${cardClassName} overflow-hidden`}>
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <h2 className="text-sm font-medium">Runtimes</h2>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {loadingRuntimes ? (
                <div className="px-4 py-5 text-sm text-[var(--text-secondary)]">Loading runtimes...</div>
              ) : runtimes.length === 0 ? (
                <div className="px-4 py-5 text-sm text-[var(--text-secondary)]">No runtimes available.</div>
              ) : (
                runtimes.map((runtime) => (
                  <button
                    key={runtime.id}
                    type="button"
                    onClick={() => setSelectedRuntimeId(runtime.id)}
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-surface-hover)] ${selectedRuntimeId === runtime.id ? "bg-[var(--accent-soft)]" : ""}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{runtime.name}</span>
                      {runtime.isPrimary ? <Badge>Primary</Badge> : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                      <span>{runtime.runtimeType}</span>
                      <span>{runtime.ownerType}</span>
                      <span>{runtime.status}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="flex flex-col gap-4">
            <section className={`${cardClassName} p-4`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedRuntime?.name ?? "Select a runtime"}</h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {selectedRuntime ? `${selectedRuntime.runtimeType} catalog and defaults` : "Choose a runtime to discover available models."}
                  </p>
                </div>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter models" className={`${inputClassName} w-full sm:max-w-xs`} />
              </div>

              {providerCounts.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {providerCounts.map(([provider, count]) => <Badge key={provider}>{provider}: {count}</Badge>)}
                </div>
              ) : null}
            </section>

            <section className={`${cardClassName} p-4`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium">Default model</h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {selectedRuntime?.ownerType === "company"
                      ? "Set the team default used by agents without an override."
                      : "Personal runtimes inherit runtime defaults until team defaults are enabled for personal workspaces."}
                  </p>
                  {companyDefaultError ? <p className="mt-2 text-xs text-red-300">{companyDefaultError}</p> : null}
                </div>
                <div className="w-full space-y-2 lg:max-w-xl">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      list="runtime-model-options"
                      value={defaultDraft}
                      onChange={(event) => setDefaultDraft(event.target.value)}
                      placeholder={runtimeDefault ?? "model/provider-id"}
                      disabled={selectedRuntime?.ownerType !== "company" || !selectedRuntime.ownerCompanyId}
                      className={inputClassName}
                    />
                    <button type="button" onClick={saveCompanyDefault} disabled={savingDefault || !defaultDraft.trim() || selectedRuntime?.ownerType !== "company"} className={buttonClassName}>Save default</button>
                    <button type="button" onClick={clearCompanyDefault} disabled={savingDefault || !companyDefault || selectedRuntime?.ownerType !== "company"} className={buttonClassName}>Clear</button>
                  </div>
                  <div className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
                    <span className="text-[var(--text-tertiary)]">Current default: </span>
                    <span className="font-medium">{defaultResolution.model ?? "No model selected"}</span>
                    <span className="ml-2 text-[var(--text-tertiary)]">({sourceLabels[defaultResolution.source]})</span>
                  </div>
                </div>
              </div>
            </section>

            <section className={`${cardClassName} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                <div>
                  <h2 className="text-sm font-medium">Agent assignments</h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Main and sub-agents can inherit the default or carry a runtime-synced override.</p>
                </div>
                <Badge>{selectedAgents.length} agents</Badge>
              </div>

              {agentsError ? <div className="px-4 py-5"><ErrorBanner>{agentsError}</ErrorBanner></div> : null}
              {selectedAgents.length === 0 ? (
                <div className="px-4 py-10 text-sm text-[var(--text-secondary)]">No agents are linked to this runtime.</div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {selectedAgents.map((agent) => {
                    const resolution = resolveModelDefault({ agentOverride: agent.model, companyDefault: companyDefaultModel, runtimeDefault });
                    const draft = agentDrafts[agent.id] ?? "";
                    const effectiveMissing = resolution.model ? runtimeModelIds.size > 0 && !runtimeModelIds.has(resolution.model) : true;
                    return (
                      <div key={agent.id} className="grid gap-3 px-4 py-3 xl:grid-cols-[240px_minmax(0,1fr)_260px] xl:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{agent.name}</div>
                          <div className="truncate text-xs text-[var(--text-tertiary)]">{agent.callsign} · {agent.role ?? "agent"} · {agent.status}</div>
                        </div>
                        <div className="min-w-0 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
                          <div className="text-[var(--text-tertiary)]">Effective model</div>
                          <div className={`mt-1 truncate text-sm font-medium ${effectiveMissing ? "text-amber-300" : "text-[var(--text-primary)]"}`}>{resolution.model ?? "Unresolved"}</div>
                          <div className="mt-1 text-[var(--text-tertiary)]">{sourceLabels[resolution.source]}{agent.runtimeRef ? " · runtime synced on save" : ""}</div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                          <input
                            list="runtime-model-options"
                            value={draft}
                            onChange={(event) => setAgentDrafts((current) => ({ ...current, [agent.id]: event.target.value }))}
                            placeholder="inherit default"
                            className={inputClassName}
                          />
                          <button type="button" onClick={() => saveAgentOverride(agent)} disabled={savingAgentId === agent.id || draft.trim() === (agent.model ?? "")} className={buttonClassName}>Save</button>
                          <button type="button" onClick={() => clearAgentOverride(agent)} disabled={savingAgentId === agent.id || !agent.model} className={buttonClassName}>Inherit</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        </div>

        <section className={`${cardClassName} overflow-hidden`}>
          <div className="grid grid-cols-[minmax(0,1fr)_160px] border-b border-[var(--border-subtle)] px-4 py-3 text-xs font-medium uppercase text-[var(--text-tertiary)]">
            <span>Model</span>
            <span>Provider</span>
          </div>

          {!selectedRuntimeId ? (
            <div className="px-4 py-10 text-sm text-[var(--text-secondary)]">Select a runtime.</div>
          ) : selectedModelsState?.loading ? (
            <div className="px-4 py-10 text-sm text-[var(--text-secondary)]">Discovering models...</div>
          ) : selectedModelsState?.error ? (
            <div className="px-4 py-10 text-sm text-red-300">{selectedModelsState.error}</div>
          ) : filteredModels.length === 0 ? (
            <div className="px-4 py-10 text-sm text-[var(--text-secondary)]">No models matched.</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {filteredModels.map((model) => (
                <div key={`${model.runtimeId}:${model.id}`} className="grid grid-cols-[minmax(0,1fr)_160px] gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{model.name}</div>
                    <div className="truncate text-xs text-[var(--text-tertiary)]">{model.id}</div>
                  </div>
                  <div className="truncate text-sm text-[var(--text-secondary)]">{model.provider}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${cardClassName} overflow-hidden`}>
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-sm font-medium">Profiles</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Built-in role profiles plus saved workspace profiles.</p>
          </div>

          {profilesError ? (
            <div className="px-4 py-5 text-sm text-red-300">{profilesError}</div>
          ) : (
            <div className="grid gap-px bg-[var(--border-subtle)] sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((profile) => (
                <div key={profile.id} className="bg-[var(--bg-surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{profile.label}</div>
                      <div className="mt-1 text-xs text-[var(--text-tertiary)]">{profile.id}</div>
                    </div>
                    <Badge>{profile.supported ? "Supported" : "Unmatched"}</Badge>
                  </div>
                  <div className="mt-3 text-xs text-[var(--text-secondary)]">Preference: {profile.providerPreferences.join(" → ")}</div>
                  {profile.recommendedModel ? <div className="mt-3 truncate rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2 text-xs">Recommended: {profile.recommendedModel}</div> : null}
                </div>
              ))}
              {persistedProfiles.map((profile) => (
                <div key={profile.id} className="bg-[var(--bg-surface)] p-4">
                  <div className="text-sm font-medium">{profile.name}</div>
                  <div className="mt-1 text-xs text-[var(--text-tertiary)]">{profile.slug}</div>
                  <div className="mt-3 truncate rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2 text-xs">Primary: {profile.primaryModel ?? "unset"}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <datalist id="runtime-model-options">
          {modelOptions.map((modelId) => <option key={modelId} value={modelId} />)}
        </datalist>
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)]">{children}</span>;
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">{children}</div>;
}

function readDefaultModel(snapshot: Record<string, unknown> | null | undefined): string | null {
  return typeof snapshot?.defaultModel === "string" && snapshot.defaultModel.trim() ? snapshot.defaultModel.trim() : null;
}

function resolvePersistedProfileModel(profileId: string | null | undefined, profiles: PersistedModelProfile[]): string | null {
  if (!profileId) return null;
  return profiles.find((profile) => profile.id === profileId)?.primaryModel ?? null;
}
