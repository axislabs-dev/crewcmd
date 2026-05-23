"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_AGENT_VOICE_SETTINGS,
  TTS_PROVIDER_OPTIONS,
  isRealtimeVoiceOption,
  normalizeAgentVoiceSettings,
  type AgentVoiceSettings,
  type TtsProviderId,
  type TtsVoiceOption,
} from "@/lib/tts-voices";
import {
  AGENT_VISUAL_STYLE_OPTIONS,
  DEFAULT_AGENT_VISUAL_SETTINGS,
  normalizeAgentVisualSettings,
  type AgentVisualAccent,
  type AgentVisualIntensity,
  type AgentVisualSettings,
} from "@/lib/agent-visual-settings";

const FAVORITES_KEY = "crewcmd.tts.favorite-voices";

type ProviderFilter = TtsProviderId | "all" | "favorites" | "realtime";

type VoiceSelectModalProps = {
  open: boolean;
  title?: string;
  value?: AgentVoiceSettings | null;
  visualValue?: AgentVisualSettings | null;
  onClose: () => void;
  onSelect: (settings: AgentVoiceSettings) => void;
  onVisualSelect?: (settings: AgentVisualSettings) => void;
  initialTab?: "voice" | "visual";
  visualOnly?: boolean;
  helperText?: string;
};

function voiceKey(voice: Pick<TtsVoiceOption, "provider" | "id">) {
  return `${voice.provider}:${voice.id}`;
}

function uniqueVoices(voices: TtsVoiceOption[]) {
  const seen = new Set<string>();
  return voices.filter((voice) => {
    const key = voiceKey(voice);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  visualValue,
  onClose,
  onSelect,
  onVisualSelect,
  initialTab = "voice",
  visualOnly = false,
  helperText,
}: VoiceSelectModalProps) {
  const current = normalizeAgentVoiceSettings(value ?? DEFAULT_AGENT_VOICE_SETTINGS);
  const currentVisual = normalizeAgentVisualSettings(visualValue ?? DEFAULT_AGENT_VISUAL_SETTINGS);
  const [tab, setTab] = useState<"voice" | "visual">(visualOnly ? "visual" : initialTab);
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [query, setQuery] = useState("");
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [providerCounts, setProviderCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [speed, setSpeed] = useState(current.speed ?? 1);
  const [preferNative, setPreferNative] = useState(current.preferNative ?? false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewState, setPreviewState] = useState<{ key: string; status: "loading" | "playing" } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(visualOnly ? "visual" : initialTab);
    setFavorites(readFavorites());
    setSpeed(current.speed ?? 1);
    setPreferNative(current.preferNative ?? false);
  }, [open, current.speed, current.preferNative, initialTab, visualOnly]);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams();
    if (provider !== "favorites") params.set("provider", provider === "all" || provider === "realtime" ? "all" : provider);
    if (query.trim()) params.set("q", query.trim());
    setLoading(true);
    setError(null);
    fetch(`/api/tts/voices?${params.toString()}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Voice list failed: ${response.status}`)))
      .then((data: { voices?: TtsVoiceOption[]; providers?: Record<string, number> }) => {
        const serverVoices = Array.isArray(data.voices) ? data.voices : [];
        const browserVoices = (provider === "all" || provider === "browser" || provider === "favorites")
          ? listBrowserVoices().filter((voice) => matchesQuery(voice, query))
          : [];
        const nextVoices = uniqueVoices([...serverVoices, ...browserVoices]);
        setVoices(nextVoices);
        if (provider === "all" || provider === "realtime" || provider === "favorites") {
          setProviderCounts(mergeProviderCounts(readProviderCounts(data.providers), summarizeProviders(browserVoices)));
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load voices");
        setVoices([]);
        setProviderCounts({});
      })
      .finally(() => setLoading(false));
  }, [open, provider, query]);

  const filteredVoices = useMemo(() => {
    if (provider === "realtime") return voices.filter(isRealtimeVoiceOption);
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

  const stopSample = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      if (previewAudioRef.current.src.startsWith("blob:")) URL.revokeObjectURL(previewAudioRef.current.src);
      previewAudioRef.current = null;
    }
    setPreviewState(null);
  };

  const playSample = async (voice: TtsVoiceOption) => {
    const key = voiceKey(voice);
    if (previewState?.key === key) {
      stopSample();
      return;
    }
    const sampleText = `Hi, I’m ${voice.name}. This is how I’ll sound in CrewCMD.`;
    stopSample();
    setPreviewState({ key, status: "loading" });
    try {
      if (voice.previewUrl) {
        const audio = new Audio(voice.previewUrl);
        previewAudioRef.current = audio;
        audio.onplay = () => setPreviewState({ key, status: "playing" });
        audio.onended = stopSample;
        await audio.play();
        return;
      }

      if (voice.provider === "browser" && typeof window !== "undefined" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(sampleText);
        utterance.rate = speed;
        const browserVoice = window.speechSynthesis
          .getVoices()
          .find((candidate) => candidate.voiceURI === voice.id || candidate.name === voice.id || candidate.name === voice.name);
        if (browserVoice) utterance.voice = browserVoice;
        utterance.onstart = () => setPreviewState({ key, status: "playing" });
        utterance.onend = stopSample;
        utterance.onerror = stopSample;
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
      previewAudioRef.current = audio;
      audio.playbackRate = speed;
      audio.onplay = () => setPreviewState({ key, status: "playing" });
      audio.onended = stopSample;
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to play voice sample");
      stopSample();
    }
  };

  if (!open) return null;

  const selectedKey = current.provider && current.voiceId ? `${current.provider}:${current.voiceId}` : "";

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-primary)] shadow-2xl sm:max-h-[86vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-subtle)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {helperText ?? (onVisualSelect ? "Pick how this agent sounds and appears." : "Pick how this agent sounds.")}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">×</button>
          </div>
          {onVisualSelect && !visualOnly ? (
            <div className="mt-4 flex gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-1">
              {(["voice", "visual"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium capitalize transition ${
                    tab === item
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "voice" && !visualOnly ? (
          <>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search voices"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#00f0ff]/50"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {[{ value: "all", label: "All" }, { value: "realtime", label: "Realtime" }, { value: "favorites", label: "Favorites" }, ...TTS_PROVIDER_OPTIONS.filter((item) => item.value !== "auto")].map((item) => (
                shouldShowProviderFilter(item.value, providerCounts) ? (
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
                ) : null
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 text-sm text-[var(--text-secondary)]">
              <span>Native</span>
              <input type="checkbox" checked={preferNative} onChange={(event) => setPreferNative(event.target.checked)} />
            </label>
            <label className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              <span className="whitespace-nowrap">Speed {speed.toFixed(2)}×</span>
              <input className="w-full" type="range" min="0.7" max="1.3" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            </label>
          </div>
          </>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "visual" && onVisualSelect ? (
            <VisualStylePane
              value={currentVisual}
              onChange={onVisualSelect}
            />
          ) : (
          <>
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
              const sampleState = previewState?.key === key ? previewState.status : null;
              const realtimeCapable = isRealtimeVoiceOption(voice);
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        realtimeCapable
                          ? "border-[#00f0ff]/40 bg-[#00f0ff]/10 text-[#00f0ff]"
                          : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
                      }`}>
                        {realtimeCapable ? "Realtime" : "TTS"}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); toggleFavorite(voice); }}
                        className={`rounded-full px-2 py-0.5 text-xl leading-none ${favorite ? "text-amber-300" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"}`}
                        aria-label={favorite ? "Remove favorite" : "Add favorite"}
                      >
                        ★
                      </button>
                    </div>
                  </div>
                  {voice.description && <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{voice.description}</p>}
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); playSample(voice); }}
                    className="mt-3 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] transition hover:border-[#00f0ff]/40 hover:text-[#00f0ff]"
                    aria-label={sampleState ? "Stop sample" : "Play sample"}
                  >
                    {sampleState === "loading" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : sampleState === "playing" ? "■" : "▶"}
                  </button>
                </div>
              );
            })}
          </div>
          </>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--border-subtle)] p-4">
          <button type="button" onClick={onClose} className="rounded-lg bg-[var(--bg-surface-hover)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function VisualStylePane({
  value,
  onChange,
}: {
  value: AgentVisualSettings;
  onChange: (settings: AgentVisualSettings) => void;
}) {
  const settings = normalizeAgentVisualSettings(value);
  const [draftAccentColor, setDraftAccentColor] = useState(settings.accentColor ?? "#63b7aa");
  useEffect(() => {
    setDraftAccentColor(settings.accentColor ?? "#63b7aa");
  }, [settings.accentColor]);
  const patch = (next: Partial<AgentVisualSettings>) => onChange(normalizeAgentVisualSettings({ ...settings, ...next }));
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {AGENT_VISUAL_STYLE_OPTIONS.map((style) => {
          const selected = settings.styleId === style.id;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => patch({ styleId: style.id })}
              className={`rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-[var(--accent)]/60 bg-[var(--accent-soft)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)]"
              }`}
            >
              <span className="block text-sm font-semibold text-[var(--text-primary)]">{style.name}</span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">{style.description}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          <span className="block font-medium text-[var(--text-primary)]">Accent</span>
          <select
            value={settings.accent}
            onChange={(event) => patch({ accent: event.target.value as AgentVisualAccent })}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="agent">Agent color</option>
            <option value="team">Team color</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          <span className="block font-medium text-[var(--text-primary)]">Color</span>
          <input
            type="color"
            value={draftAccentColor}
            onChange={(event) => setDraftAccentColor(event.target.value)}
            onBlur={() => patch({ accent: "custom", accentColor: draftAccentColor })}
            className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 outline-none"
          />
          <button
            type="button"
            onClick={() => patch({ accent: "custom", accentColor: draftAccentColor })}
            className="mt-1 w-full rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
          >
            Apply color
          </button>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          <span className="block font-medium text-[var(--text-primary)]">Intensity</span>
          <select
            value={settings.intensity}
            onChange={(event) => patch({ intensity: event.target.value as AgentVisualIntensity })}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="calm">Calm</option>
            <option value="balanced">Balanced</option>
            <option value="vivid">Vivid</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function summarizeProviders(voices: TtsVoiceOption[]) {
  return voices.reduce<Record<string, number>>((acc, voice) => {
    acc[voice.provider] = (acc[voice.provider] || 0) + 1;
    return acc;
  }, {});
}

function readProviderCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) counts[key] = count;
  }
  return counts;
}

function mergeProviderCounts(...items: Array<Record<string, number>>) {
  return items.reduce<Record<string, number>>((acc, item) => {
    for (const [key, count] of Object.entries(item)) acc[key] = (acc[key] || 0) + count;
    return acc;
  }, {});
}

function shouldShowProviderFilter(value: string, counts: Record<string, number>) {
  if (value === "all" || value === "realtime" || value === "favorites") return true;
  return (counts[value] || 0) > 0;
}

export function VoiceSummary({ value }: { value?: AgentVoiceSettings | null }) {
  const settings = normalizeAgentVoiceSettings(value ?? DEFAULT_AGENT_VOICE_SETTINGS);
  if (settings.enabled === false) return <span>Voice disabled</span>;
  const provider = TTS_PROVIDER_OPTIONS.find((item) => item.value === settings.provider)?.label ?? settings.provider ?? "Auto";
  const name = settings.voiceName || settings.voiceId || (settings.preferNative ? "Device default" : "Auto voice");
  const realtime = settings.provider && settings.voiceId
    ? isRealtimeVoiceOption({ provider: settings.provider as TtsProviderId, id: settings.voiceId })
    : false;
  return <span>{name} · {provider}{realtime ? " · realtime" : ""}{settings.preferNative ? " · native preferred" : ""}</span>;
}

export function VisualSummary({ value }: { value?: AgentVisualSettings | null }) {
  const settings = normalizeAgentVisualSettings(value ?? DEFAULT_AGENT_VISUAL_SETTINGS);
  const style = AGENT_VISUAL_STYLE_OPTIONS.find((item) => item.id === settings.styleId);
  const accent = settings.accent === "custom" && settings.accentColor
    ? settings.accentColor
    : settings.accent === "team"
      ? "Team color"
      : "Agent color";
  return <span>{style?.name ?? "Orbital Reactor"} · {accent} · {settings.intensity}</span>;
}
