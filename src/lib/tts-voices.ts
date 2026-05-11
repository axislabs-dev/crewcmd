export type TtsProviderId = "openai" | "elevenlabs" | "say" | "browser";

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
  provider?: TtsProviderId | "auto" | "";
  voiceId?: string;
  voiceName?: string;
  model?: string;
  speed?: number;
  preferNative?: boolean;
}

export const TTS_PROVIDER_OPTIONS: Array<{ value: TtsProviderId | "auto"; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Use the best configured backend" },
  { value: "openai", label: "OpenAI", description: "Cloud neural voices" },
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

export const DEFAULT_AGENT_VOICE_SETTINGS: AgentVoiceSettings = {
  enabled: true,
  provider: "auto",
  voiceId: "onyx",
  voiceName: "Onyx",
  model: "tts-1",
  speed: 1,
  preferNative: false,
};

export function normalizeAgentVoiceSettings(value: unknown): AgentVoiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AGENT_VOICE_SETTINGS };
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_AGENT_VOICE_SETTINGS.enabled,
    provider: typeof record.provider === "string" ? (record.provider as AgentVoiceSettings["provider"]) : "auto",
    voiceId: typeof record.voiceId === "string" ? record.voiceId : "",
    voiceName: typeof record.voiceName === "string" ? record.voiceName : "",
    model: typeof record.model === "string" ? record.model : "",
    speed: typeof record.speed === "number" && Number.isFinite(record.speed) ? record.speed : 1,
    preferNative: typeof record.preferNative === "boolean" ? record.preferNative : false,
  };
}
