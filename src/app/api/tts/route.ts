import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { exec } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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

    if (!text || typeof text !== "string") {
      return Response.json(
        { error: "text string is required" },
        { status: 400 }
      );
    }

    // 1. Try OpenAI TTS (best quality)
    if (OPENAI_API_KEY) {
      const result = await tryOpenAITTS(text);
      if (result) return result;
    }

    // 2. Try local TTS CLI
    const localResult = await tryLocalTTS(text);
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
async function tryOpenAITTS(text: string): Promise<Response | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "onyx",
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

  const result = await new Promise<TTSBinInfo | null>((resolve) => {
    // Check piper first (neural TTS, good quality)
    exec("which piper", (err, stdout) => {
      if (!err && stdout.trim()) {
        resolve({ path: stdout.trim(), name: "piper" });
        return;
      }

      // macOS built-in
      exec("which say", (err2, stdout2) => {
        if (!err2 && stdout2.trim()) {
          resolve({ path: stdout2.trim(), name: "say" });
          return;
        }

        // Linux fallback
        exec("which espeak-ng || which espeak", (err3, stdout3) => {
          if (!err3 && stdout3.trim()) {
            const bin = stdout3.trim().split("\n")[0];
            resolve({ path: bin, name: bin.includes("espeak-ng") ? "espeak-ng" : "espeak" });
            return;
          }
          resolve(null);
        });
      });
    });
  });

  ttsBinCache = result;
  return result;
}

let ttsBinCache: TTSBinInfo | null | undefined = undefined;

/**
 * Try local TTS CLI.
 * macOS `say` outputs AIFF; espeak/piper output WAV.
 */
async function tryLocalTTS(text: string): Promise<Response | null> {
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

  // Sanitize text for shell (escape single quotes)
  const safeText = processed.replace(/'/g, "'\\''");

  try {
    let cmd: string;
    switch (bin.name) {
      case "say":
        // macOS: -o outputs to file, --data-format=LEI16@44100 forces 44.1kHz WAV
        // -r 195 slightly slower for natural pacing; uses system default voice (works on any Mac)
        cmd = `'${bin.path}' -r 195 --data-format=LEI16@44100 -o '${tempPath}' '${safeText}'`;
        break;
      case "piper":
        // piper reads from stdin
        cmd = `echo '${safeText}' | '${bin.path}' --output_file '${tempPath}'`;
        break;
      default:
        // espeak / espeak-ng
        cmd = `'${bin.path}' -w '${tempPath}' '${safeText}'`;
        break;
    }

    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

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
