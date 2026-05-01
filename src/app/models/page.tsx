"use client";

import { useEffect, useMemo, useState } from "react";

interface RuntimeRecord {
  id: string;
  name: string;
  runtimeType: string;
  status: string;
  isPrimary: boolean;
  ownerType: "user" | "company";
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

const cardClassName = "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]";

export default function ModelsPage() {
  const [runtimes, setRuntimes] = useState<RuntimeRecord[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<Record<string, RuntimeModelsState>>({});
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : "Failed to load runtimes");
        }
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
      setRuntimeModels((current) => ({
        ...current,
        [runtimeId]: { loading: true, error: null, models: [] },
      }));

      try {
        const response = await fetch(`/api/runtimes/${runtimeId}/models`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to discover models");

        if (!cancelled) {
          setRuntimeModels((current) => ({
            ...current,
            [runtimeId]: {
              loading: false,
              error: null,
              models: Array.isArray(data.models) ? data.models : [],
            },
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
        }
      } catch (error) {
        if (!cancelled) {
          setProfilesError(error instanceof Error ? error.message : "Failed to load model profiles");
        }
      }
    }

    void loadProfiles();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === selectedRuntimeId) ?? null;
  const selectedModelsState = selectedRuntimeId ? runtimeModels[selectedRuntimeId] : null;

  const filteredModels = useMemo(() => {
    const search = query.trim().toLowerCase();
    const models = selectedModelsState?.models ?? [];
    if (!search) return models;

    return models.filter((model) => {
      return (
        model.id.toLowerCase().includes(search) ||
        model.name.toLowerCase().includes(search) ||
        model.provider.toLowerCase().includes(search)
      );
    });
  }, [query, selectedModelsState?.models]);

  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of selectedModelsState?.models ?? []) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedModelsState?.models]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-4 py-6 text-[var(--text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-2 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Read-only runtime model discovery.
            </p>
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">
            Profile and assignment writes are not enabled in this view.
          </div>
        </header>

        {runtimeError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {runtimeError}
          </div>
        ) : null}

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
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-surface-hover)] ${
                      selectedRuntimeId === runtime.id ? "bg-[var(--accent-soft)]" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{runtime.name}</span>
                      {runtime.isPrimary ? (
                        <span className="rounded border border-[var(--accent-medium)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--accent)]">
                          Primary
                        </span>
                      ) : null}
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
                    {selectedRuntime
                      ? `${selectedRuntime.runtimeType} runtime model catalog`
                      : "Choose a runtime to discover available models."}
                  </p>
                </div>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter models"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] sm:max-w-xs"
                />
              </div>

              {providerCounts.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {providerCounts.map(([provider, count]) => (
                    <span
                      key={provider}
                      className="rounded border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)]"
                    >
                      {provider}: {count}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

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
                    <div
                      key={`${model.runtimeId}:${model.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_160px] gap-3 px-4 py-3"
                    >
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
          </main>
        </div>

        <section className={`${cardClassName} overflow-hidden`}>
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-sm font-medium">Built-in Profiles</h2>
          </div>

          {profilesError ? (
            <div className="px-4 py-5 text-sm text-red-300">{profilesError}</div>
          ) : profiles.length === 0 ? (
            <div className="px-4 py-5 text-sm text-[var(--text-secondary)]">No profiles available.</div>
          ) : (
            <div className="grid gap-px bg-[var(--border-subtle)] sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((profile) => (
                <div key={profile.id} className="bg-[var(--bg-surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{profile.label}</div>
                      <div className="mt-1 text-xs text-[var(--text-tertiary)]">{profile.id}</div>
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                        profile.supported
                          ? "border-emerald-500/30 text-emerald-300"
                          : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                      }`}
                    >
                      {profile.supported ? "Supported" : "Unmatched"}
                    </span>
                  </div>

                  <div className="mt-3 text-xs text-[var(--text-secondary)]">
                    Preference: {profile.providerPreferences.join(" -> ")}
                  </div>

                  {profile.recommendedModel ? (
                    <div className="mt-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] px-3 py-2 text-xs">
                      <div className="text-[var(--text-tertiary)]">Recommended</div>
                      <div className="mt-1 truncate text-[var(--text-primary)]">{profile.recommendedModel}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
