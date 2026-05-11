import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAuth } from "@/lib/require-auth";
import { OPENAI_TTS_VOICES, type TtsVoiceOption, type TtsProviderId } from "@/lib/tts-voices";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1";

type ProviderFilter = TtsProviderId | "all";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const provider = normalizeProvider(request.nextUrl.searchParams.get("provider"));
  const query = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  const providers: TtsProviderId[] = provider === "all" ? ["openai", "elevenlabs", "say", "browser"] : [provider];
  const settled = await Promise.allSettled(providers.map((p) => listProviderVoices(p)));
  const voices = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const filtered = query
    ? voices.filter((voice) =>
        [voice.name, voice.id, voice.language, voice.description, voice.provider]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      )
    : voices;

  return NextResponse.json({ voices: filtered, providers: summarizeProviders(voices) });
}

function normalizeProvider(value: string | null): ProviderFilter {
  if (value === "openai" || value === "elevenlabs" || value === "say" || value === "browser") return value;
  return "all";
}

async function listProviderVoices(provider: TtsProviderId): Promise<TtsVoiceOption[]> {
  switch (provider) {
    case "openai":
      return OPENAI_TTS_VOICES;
    case "elevenlabs":
      return listElevenLabsVoices();
    case "say":
      return listSayVoices();
    case "browser":
      return [];
  }
}

async function listElevenLabsVoices(): Promise<TtsVoiceOption[]> {
  if (!ELEVENLABS_API_KEY) return [];
  const response = await fetch(`${ELEVENLABS_BASE_URL.replace(/\/$/, "")}/voices`, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = await response.json() as { voices?: Array<Record<string, unknown>> };
  return (data.voices || [])
    .map((voice) => ({
      id: typeof voice.voice_id === "string" ? voice.voice_id : "",
      name: typeof voice.name === "string" ? voice.name : "Unnamed voice",
      provider: "elevenlabs" as const,
      description: readElevenDescription(voice),
      previewUrl: typeof voice.preview_url === "string" ? voice.preview_url : null,
    }))
    .filter((voice) => voice.id);
}

function readElevenDescription(voice: Record<string, unknown>): string | null {
  const labels = voice.labels && typeof voice.labels === "object" && !Array.isArray(voice.labels)
    ? voice.labels as Record<string, unknown>
    : null;
  if (!labels) return null;
  return [labels.accent, labels.description, labels.age, labels.gender, labels.use_case]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" · ") || null;
}

async function listSayVoices(): Promise<TtsVoiceOption[]> {
  try {
    const { stdout } = await execFileAsync("say", ["-v", "?"], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const voices: TtsVoiceOption[] = [];
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = line.match(/^(\S+)\s+([\w-]+)\s+#\s*(.*)$/);
      if (!match) continue;
      voices.push({
        id: match[1],
        name: match[1],
        provider: "say",
        language: match[2],
        description: match[3] || null,
      });
    }
    return voices;
  } catch {
    return [];
  }
}

function summarizeProviders(voices: TtsVoiceOption[]) {
  return voices.reduce<Record<string, number>>((acc, voice) => {
    acc[voice.provider] = (acc[voice.provider] || 0) + 1;
    return acc;
  }, {});
}
