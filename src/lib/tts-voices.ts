export type TtsProviderId = "openai" | "google" | "elevenlabs" | "say" | "browser";

export interface TtsVoiceOption {
  id: string;
  name: string;
  provider: TtsProviderId;
  language?: string | null;
  description?: string | null;
  previewUrl?: string | null;
}

export interface AgentVoiceSettings {
  enabled?: boolean;
  realtime?: boolean;
  provider?: TtsProviderId | "auto" | "";
  voiceId?: string;
  voiceName?: string;
  model?: string;
  speed?: number;
  preferNative?: boolean;
}

export const TTS_PROVIDER_OPTIONS: Array<{ value: TtsProviderId | "auto"; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Use the best available device or configured backend voice" },
  { value: "openai", label: "OpenAI", description: "Cloud neural voices" },
  { value: "google", label: "Google", description: "Gemini realtime voices" },
  { value: "elevenlabs", label: "ElevenLabs", description: "Large voice library when configured" },
  { value: "say", label: "macOS say", description: "Local system voices" },
  { value: "browser", label: "Browser", description: "Web Speech voices on this device" },
];

export const OPENAI_TTS_VOICES: TtsVoiceOption[] = [
  { id: "alloy", name: "Alloy", provider: "openai", description: "Balanced, neutral" },
  { id: "ash", name: "Ash", provider: "openai", description: "Calm, steady" },
  { id: "ballad", name: "Ballad", provider: "openai", description: "Warm, expressive" },
  { id: "cedar", name: "Cedar", provider: "openai", description: "Grounded, low" },
  { id: "coral", name: "Coral", provider: "openai", description: "Bright, friendly" },
  { id: "echo", name: "Echo", provider: "openai", description: "Clear, conversational" },
  { id: "fable", name: "Fable", provider: "openai", description: "Storytelling tone" },
  { id: "juniper", name: "Juniper", provider: "openai", description: "Natural, upbeat" },
  { id: "onyx", name: "Onyx", provider: "openai", description: "Deep, direct" },
  { id: "nova", name: "Nova", provider: "openai", description: "Polished, energetic" },
  { id: "sage", name: "Sage", provider: "openai", description: "Measured, thoughtful" },
  { id: "shimmer", name: "Shimmer", provider: "openai", description: "Light, clear" },
];

export const OPENAI_REALTIME_VOICE_IDS = new Set([
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
]);

export const GOOGLE_REALTIME_VOICES: TtsVoiceOption[] = [
  { id: "Kore", name: "Kore", provider: "google", description: "Gemini realtime default" },
  { id: "Puck", name: "Puck", provider: "google", description: "Gemini realtime voice" },
];

export const GOOGLE_REALTIME_VOICE_IDS = new Set(
  GOOGLE_REALTIME_VOICES.map((voice) => voice.id.toLowerCase()),
);

export const DEFAULT_AGENT_VOICE_SETTINGS: AgentVoiceSettings = {
  enabled: true,
  realtime: true,
  provider: "auto",
  voiceId: "",
  voiceName: "",
  model: "",
  speed: 1,
  preferNative: true,
};

function isLegacyAutoOpenAIDefault(record: Record<string, unknown>) {
  return (
    (record.provider === "auto" || record.provider === "" || record.provider === undefined) &&
    record.voiceId === "onyx" &&
    record.voiceName === "Onyx" &&
    (record.model === "tts-1" || record.model === "" || record.model === undefined) &&
    (record.preferNative === false || record.preferNative === undefined)
  );
}

export function normalizeAgentVoiceSettings(value: unknown): AgentVoiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AGENT_VOICE_SETTINGS };
  const record = value as Record<string, unknown>;
  if (isLegacyAutoOpenAIDefault(record)) return { ...DEFAULT_AGENT_VOICE_SETTINGS };
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_AGENT_VOICE_SETTINGS.enabled,
    realtime: typeof record.realtime === "boolean" ? record.realtime : DEFAULT_AGENT_VOICE_SETTINGS.realtime,
    provider: typeof record.provider === "string" ? (record.provider as AgentVoiceSettings["provider"]) : DEFAULT_AGENT_VOICE_SETTINGS.provider,
    voiceId: typeof record.voiceId === "string" ? record.voiceId : "",
    voiceName: typeof record.voiceName === "string" ? record.voiceName : "",
    model: typeof record.model === "string" ? record.model : "",
    speed: typeof record.speed === "number" && Number.isFinite(record.speed) ? record.speed : 1,
    preferNative: typeof record.preferNative === "boolean" ? record.preferNative : DEFAULT_AGENT_VOICE_SETTINGS.preferNative,
  };
}

export function isExplicitServerVoice(voice: AgentVoiceSettings) {
  return voice.provider === "openai" || voice.provider === "elevenlabs";
}

export function shouldUseDeviceTts(voice: AgentVoiceSettings) {
  return (
    voice.provider === "auto" ||
    voice.provider === "browser" ||
    voice.provider === "say" ||
    (voice.preferNative === true && !isExplicitServerVoice(voice))
  );
}

export function isRealtimeVoiceOption(voice: Pick<TtsVoiceOption, "provider" | "id">) {
  const voiceId = voice.id.trim().toLowerCase();
  return (
    (voice.provider === "openai" && OPENAI_REALTIME_VOICE_IDS.has(voiceId)) ||
    (voice.provider === "google" && GOOGLE_REALTIME_VOICE_IDS.has(voiceId))
  );
}
