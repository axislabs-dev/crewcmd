"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_AGENT_VOICE_SETTINGS,
  TTS_PROVIDER_OPTIONS,
  normalizeAgentVoiceSettings,
  type AgentVoiceSettings,
  type TtsProviderId,
  type TtsVoiceOption,
} from "@/lib/tts-voices";

const FAVORITES_KEY = "crewcmd.tts.favorite-voices";

type ProviderFilter = TtsProviderId | "all" | "favorites";

type VoiceSelectModalProps = {
  open: boolean;
  title?: string;
  value?: AgentVoiceSettings | null;
  onClose: () => void;
  onSelect: (settings: AgentVoiceSettings) => void;
  allowDisable?: boolean;
  helperText?: string;
};

function voiceKey(voice: Pick<TtsVoiceOption, "provider" | "id">) {
  return `${voice.provider}:${voice.id}`;
}

function readFavorites() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(favorites: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function listBrowserVoices(): TtsVoiceOption[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().map((voice) => ({
    id: voice.voiceURI || voice.name,
    name: voice.name,
    provider: "browser" as const,
    language: voice.lang || undefined,
    description: `${voice.localService ? "Device voice" : "Browser voice"}${voice.default ? " · default" : ""}`,
  }));
}

function matchesQuery(voice: TtsVoiceOption, query: string) {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return [voice.name, voice.id, voice.language, voice.description, voice.provider]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export function VoiceSelectModal({
  open,
  title = "Choose voice",
  value,
  onClose,
  onSelect,
  allowDisable = true,
  helperText,
}: VoiceSelectModalProps) {
  const current = normalizeAgentVoiceSettings(value ?? DEFAULT_AGENT_VOICE_SETTINGS);
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [query, setQuery] = useState("");
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [speed, setSpeed] = useState(current.speed ?? 1);
  const [preferNative, setPreferNative] = useState(current.preferNative ?? false);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFavorites(readFavorites());
    setSpeed(current.speed ?? 1);
    setPreferNative(current.preferNative ?? false);
  }, [open, current.speed, current.preferNative]);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams();
    if (provider !== "favorites") params.set("provider", provider === "all" ? "all" : provider);
    if (query.trim()) params.set("q", query.trim());
    setLoading(true);
    setError(null);
    fetch(`/api/tts/voices?${params.toString()}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Voice list failed: ${response.status}`)))
      .then((data: { voices?: TtsVoiceOption[] }) => {
        const serverVoices = Array.isArray(data.voices) ? data.voices : [];
        const browserVoices = (provider === "all" || provider === "browser" || provider === "favorites")
          ? listBrowserVoices().filter((voice) => matchesQuery(voice, query))
          : [];
        setVoices([...serverVoices, ...browserVoices]);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load voices");
        setVoices([]);
      })
      .finally(() => setLoading(false));
  }, [open, provider, query]);

  const filteredVoices = useMemo(() => {
    if (provider !== "favorites") return voices;
    const favoriteSet = new Set(favorites);
    return voices.filter((voice) => favoriteSet.has(voiceKey(voice)));
  }, [favorites, provider, voices]);

  const toggleFavorite = (voice: TtsVoiceOption) => {
    const key = voiceKey(voice);
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    setFavorites(next);
    writeFavorites(next);
  };

  const playSample = async (voice: TtsVoiceOption) => {
    const key = voiceKey(voice);
    const sampleText = `Hi, I’m ${voice.name}. This is how I’ll sound in CrewCMD.`;
    setPreviewingKey(key);
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      if (voice.previewUrl) {
        await new Audio(voice.previewUrl).play();
        return;
      }

      if (voice.provider === "browser" && typeof window !== "undefined" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(sampleText);
        utterance.rate = speed;
        const browserVoice = window.speechSynthesis
          .getVoices()
          .find((candidate) => candidate.voiceURI === voice.id || candidate.name === voice.id || candidate.name === voice.name);
        if (browserVoice) utterance.voice = browserVoice;
        window.speechSynthesis.speak(utterance);
        return;
      }

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          voice: { enabled: true, provider: voice.provider, voiceId: voice.id, voiceName: voice.name, speed, preferNative },
        }),
      });
      if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
      const audio = new Audio(URL.createObjectURL(await response.blob()));
      audio.playbackRate = speed;
      audio.onended = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to play voice sample");
    } finally {
      window.setTimeout(() => setPreviewingKey((currentKey) => currentKey === key ? null : currentKey), 900);
    }
  };

  if (!open) return null;

  const selectedKey = current.provider && current.voiceId ? `${current.provider}:${current.voiceId}` : "";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-subtle)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {helperText ?? "Search cloud, local, and device voices. Favorites stay on this browser for fast session overrides."}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">×</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, locale, provider, style…"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#00f0ff]/50"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {[{ value: "all", label: "All" }, { value: "favorites", label: "Favorites" }, ...TTS_PROVIDER_OPTIONS.filter((item) => item.value !== "auto")].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setProvider(item.value as ProviderFilter)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    provider === item.value
                      ? "border-[#00f0ff]/60 bg-[#00f0ff]/15 text-[#00f0ff]"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 text-sm text-[var(--text-secondary)]">
              <span>Prefer native/device voice when available</span>
              <input type="checkbox" checked={preferNative} onChange={(event) => setPreferNative(event.target.checked)} />
            </label>
            <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              <span className="whitespace-nowrap">Speed {speed.toFixed(2)}×</span>
              <input className="w-full" type="range" min="0.7" max="1.3" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && <p className="p-4 text-sm text-[var(--text-secondary)]">Loading voices…</p>}
          {error && <p className="p-4 text-sm text-amber-400">{error}</p>}
          {!loading && !error && filteredVoices.length === 0 && (
            <p className="p-4 text-sm text-[var(--text-secondary)]">No matching voices found.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredVoices.map((voice) => {
              const key = voiceKey(voice);
              const selected = key === selectedKey;
              const favorite = favorites.includes(key);
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect({ enabled: true, provider: voice.provider, voiceId: voice.id, voiceName: voice.name, model: current.model || "", speed, preferNative })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect({ enabled: true, provider: voice.provider, voiceId: voice.id, voiceName: voice.name, model: current.model || "", speed, preferNative });
                    }
                  }}
                  className={`group cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? "border-[#00f0ff]/70 bg-[#00f0ff]/12"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{voice.name}</div>
                      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
                        {voice.provider}{voice.language ? ` · ${voice.language}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); toggleFavorite(voice); }}
                      className={`rounded-full px-2 py-0.5 text-sm ${favorite ? "text-amber-300" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"}`}
                      aria-label={favorite ? "Remove favorite" : "Add favorite"}
                    >
                      ★
                    </button>
                  </div>
                  {voice.description && <p className="mt-2 line-clamp-2 text-xs text-[var(--text-secondary)]">{voice.description}</p>}
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); playSample(voice); }}
                    className="mt-3 rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[#00f0ff]/40 hover:text-[#00f0ff]"
                  >
                    {previewingKey === key ? "Playing…" : "Play sample"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] p-4">
          {allowDisable ? (
            <button
              type="button"
              onClick={() => onSelect({ ...current, enabled: false, speed, preferNative })}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Disable voice for this scope
            </button>
          ) : <span />}
          <button type="button" onClick={onClose} className="rounded-lg bg-[var(--bg-surface-hover)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function VoiceSummary({ value }: { value?: AgentVoiceSettings | null }) {
  const settings = normalizeAgentVoiceSettings(value ?? DEFAULT_AGENT_VOICE_SETTINGS);
  if (settings.enabled === false) return <span>Voice disabled</span>;
  const provider = TTS_PROVIDER_OPTIONS.find((item) => item.value === settings.provider)?.label ?? settings.provider ?? "Auto";
  return <span>{settings.voiceName || settings.voiceId || "Auto voice"} · {provider}{settings.preferNative ? " · native preferred" : ""}</span>;
}
