import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { execFile, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isExplicitServerVoice, normalizeAgentVoiceSettings, type AgentVoiceSettings } from "@/lib/tts-voices";

export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

/**
 * TTS cascade:
 * 1. OpenAI TTS API (if OPENAI_API_KEY set) — high quality
 * 2. Local `say` (macOS) or `espeak`/`piper` (Linux) — offline fallback
 * 3. Returns 503 with fallback hint — frontend uses browser speechSynthesis
 */

/**
 * GET /api/tts — probe endpoint to check if server-side TTS is available.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (OPENAI_API_KEY) {
    return Response.json({ available: true, provider: "openai" });
  }

  const localBin = await findLocalTTSBin();
  if (localBin) {
    return Response.json({ available: true, provider: localBin.name });
  }

  return Response.json({ available: false, fallback: "browser" }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { text } = body;
    const voice = normalizeAgentVoiceSettings(body.voice);

    if (!text || typeof text !== "string") {
      return Response.json(
        { error: "text string is required" },
        { status: 400 }
      );
    }

    // 1. Try OpenAI TTS (best quality)
    if (OPENAI_API_KEY && (voice.provider === "auto" || voice.provider === "openai" || !voice.provider)) {
      const result = await tryOpenAITTS(text, voice);
      if (result) return result;
    }

    if (process.env.ELEVENLABS_API_KEY && voice.provider === "elevenlabs" && voice.voiceId) {
      const result = await tryElevenLabsTTS(text, voice);
      if (result) return result;
    }

    if (isExplicitServerVoice(voice)) {
      return Response.json(
        { error: `Selected ${voice.provider} TTS voice is unavailable`, fallback: "none" },
        { status: 503 }
      );
    }

    // 2. Try local TTS CLI
    const localResult = await tryLocalTTS(text, voice);
    if (localResult) return localResult;

    // 3. No backend — tell frontend to use browser speechSynthesis
    return Response.json(
      { error: "No TTS backend available", fallback: "browser" },
      { status: 503 }
    );
  } catch (error) {
    console.error("[api/tts] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Try OpenAI TTS API.
 */
async function tryOpenAITTS(text: string, voice: AgentVoiceSettings): Promise<Response | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: voice.model || "tts-1",
        voice: voice.voiceId || "onyx",
        speed: clampSpeed(voice.speed),
        input: text,
      }),
    });

    if (!response.ok) {
      console.error("[api/tts] OpenAI error:", response.status);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[api/tts] OpenAI TTS failed:", err);
    return null;
  }
}

/**
 * Try ElevenLabs TTS API when an agent explicitly selects an ElevenLabs voice.
 */
async function tryElevenLabsTTS(text: string, voice: AgentVoiceSettings): Promise<Response | null> {
  try {
    const baseUrl = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/text-to-speech/${encodeURIComponent(voice.voiceId || "")}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
      },
      body: JSON.stringify({
        text,
        model_id: voice.model || "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
          speed: clampSpeed(voice.speed),
        },
      }),
    });

    if (!response.ok) {
      console.error("[api/tts] ElevenLabs error:", response.status);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[api/tts] ElevenLabs TTS failed:", err);
    return null;
  }
}

function clampSpeed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1;
}

interface TTSBinInfo {
  path: string;
  name: string;
}

/**
 * Find a local TTS binary.
 * macOS: `say` (built-in)
 * Linux: `piper` (neural, good quality) or `espeak` (robotic but universal)
 */
async function findLocalTTSBin(): Promise<TTSBinInfo | null> {
  if (ttsBinCache !== undefined) return ttsBinCache;

  const piper = await findExecutable("piper");
  const say = piper ? null : await findExecutable("say");
  const espeakNg = piper || say ? null : await findExecutable("espeak-ng");
  const espeak = piper || say || espeakNg ? null : await findExecutable("espeak");
  const result = piper
    ? { path: piper, name: "piper" }
    : say
      ? { path: say, name: "say" }
      : espeakNg
        ? { path: espeakNg, name: "espeak-ng" }
        : espeak
          ? { path: espeak, name: "espeak" }
          : null;

  ttsBinCache = result;
  return result;
}

let ttsBinCache: TTSBinInfo | null | undefined = undefined;

async function findExecutable(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [name], (error, stdout) => {
      const path = stdout.trim().split("\n")[0];
      resolve(error || !path ? null : path);
    });
  });
}

/**
 * Try local TTS CLI.
 * macOS `say` outputs AIFF; espeak/piper output WAV.
 */
async function tryLocalTTS(text: string, voice?: AgentVoiceSettings): Promise<Response | null> {
  const bin = await findLocalTTSBin();
  if (!bin) return null;

  const tempId = randomUUID();
  // All output as WAV for browser compatibility (say uses --data-format to force WAV)
  const tempPath = join(tmpdir(), `crewcmd-tts-${tempId}.wav`);

  // Pre-process text for any TTS engine
  let processed = text
    // Remove markdown-style formatting that TTS would read literally
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/#{1,6}\s/g, "")
    // Expand common abbreviations for clearer pronunciation
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\betc\./gi, "etcetera")
    .replace(/\bvs\./gi, "versus");

  // macOS `say` supports inline silence markers for natural pauses
  if (bin.name === "say") {
    processed = processed
      .replace(/([.!?])\s+/g, "$1 [[slnc 150]] ")
      .replace(/([;:])\s+/g, "$1 [[slnc 100]] ");
  }

  try {
    let argv: string[];
    let stdin: string | undefined;
    switch (bin.name) {
      case "say":
        // macOS: -o outputs to file, --data-format=LEI16@44100 forces 44.1kHz WAV
        // -r 195 slightly slower for natural pacing; uses system default voice (works on any Mac)
        argv = ["-r", String(Math.round(195 * clampSpeed(voice?.speed)))];
        if (voice?.provider === "say" && voice.voiceId) {
          argv.push("-v", voice.voiceId);
        }
        argv.push("--data-format=LEI16@44100", "-o", tempPath, processed);
        break;
      case "piper":
        // piper reads from stdin
        argv = ["--output_file", tempPath];
        stdin = processed;
        break;
      default:
        // espeak / espeak-ng
        argv = ["-w", tempPath, processed];
        break;
    }

    await runLocalTTSCommand(bin.path, argv, stdin);

    const audioData = await readFile(tempPath);
    await unlink(tempPath).catch(() => {});

    const contentType = "audio/wav";
    return new Response(audioData, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[api/tts] Local TTS failed:", err);
    await unlink(tempPath).catch(() => {});
    return null;
  }
}

async function runLocalTTSCommand(command: string, argv: string[], stdin?: string): Promise<void> {
  if (stdin === undefined) {
    await new Promise<void>((resolve, reject) => {
      execFile(command, argv, { timeout: 30000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, argv, { stdio: ["pipe", "ignore", "ignore"] });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Local TTS command timed out"));
    }, 30000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Local TTS command exited with code ${code}`));
    });
    child.stdin.end(stdin);
  });
}
