import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { exec } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

/**
 * STT cascade:
 * 1. Local whisper CLI (if installed) — fully offline, zero cost
 * 2. OpenAI Whisper API (if OPENAI_API_KEY set) — cloud fallback
 * 3. Returns 503 with fallback hint — frontend falls back to Web Speech API
 */
/**
 * GET /api/stt — probe endpoint to check if server-side STT is available.
 * Returns { available: true, provider: "local" | "openai" } or { available: false, fallback: "browser" }.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  // Check local whisper
  const whisperBin = await findWhisperBin();
  if (whisperBin) {
    return Response.json({ available: true, provider: whisperBin.type === "cpp" ? "whisper-cpp" : "whisper" });
  }

  // Check OpenAI key
  if (OPENAI_API_KEY) {
    return Response.json({ available: true, provider: "openai" });
  }

  return Response.json({ available: false, fallback: "browser" }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!audio || !(audio instanceof Blob)) {
      return Response.json(
        { error: "audio file is required" },
        { status: 400 }
      );
    }

    // Write audio to temp file for local whisper
    const audioBuffer = Buffer.from(await audio.arrayBuffer());
    const tempId = randomUUID();
    const tempAudioPath = join(tmpdir(), `crewcmd-stt-${tempId}.webm`);

    // 1. Try local whisper CLI
    const localResult = await tryLocalWhisper(audioBuffer, tempAudioPath);
    if (localResult) {
      return Response.json({ text: localResult, provider: "local" });
    }

    // 2. Try OpenAI Whisper API
    if (OPENAI_API_KEY) {
      const openaiResult = await tryOpenAIWhisper(audio);
      if (openaiResult) {
        return Response.json({ text: openaiResult, provider: "openai" });
      }
    }

    // 3. No backend available — tell frontend to use browser fallback
    return Response.json(
      { error: "No STT backend available", fallback: "browser" },
      { status: 503 }
    );
  } catch (error) {
    console.error("[api/stt] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Try local whisper CLI (openai-whisper python package or whisper-cpp).
 * Returns transcribed text or null if not available.
 */
async function tryLocalWhisper(
  audioBuffer: Buffer,
  tempAudioPath: string
): Promise<string | null> {
  // Check if whisper CLI exists
  const whisperBin = await findWhisperBin();
  if (!whisperBin) return null;

  try {
    await writeFile(tempAudioPath, audioBuffer);

    const outputPath = tempAudioPath.replace(/\.[^.]+$/, "");
    const text = await new Promise<string | null>((resolve) => {
      // Use base model for speed. Output as plain text.
      const args = whisperBin.type === "cpp"
        ? `"${whisperBin.path}" -m "${whisperBin.modelPath}" -f "${tempAudioPath}" --no-timestamps -otxt -of "${outputPath}"`
        : `"${whisperBin.path}" "${tempAudioPath}" --model base --language en --output_format txt --output_dir "${tmpdir()}"`;

      exec(args, { timeout: 30000 }, async (error) => {
        if (error) {
          console.error("[api/stt] Local whisper error:", error.message);
          resolve(null);
          return;
        }

        try {
          // whisper outputs to <filename>.txt
          const txtPath = `${outputPath}.txt`;
          const result = await readFile(txtPath, "utf-8");
          // Clean up output file
          await unlink(txtPath).catch(() => {});
          resolve(result.trim() || null);
        } catch {
          resolve(null);
        }
      });
    });

    return text;
  } catch (err) {
    console.error("[api/stt] Local whisper failed:", err);
    return null;
  } finally {
    await unlink(tempAudioPath).catch(() => {});
  }
}

interface WhisperBinInfo {
  path: string;
  type: "python" | "cpp";
  modelPath?: string;
}

/**
 * Find whisper binary on the system.
 * Checks for whisper-cpp first (faster), then openai-whisper python.
 */
async function findWhisperBin(): Promise<WhisperBinInfo | null> {
  // Cache the result
  if (whisperBinCache !== undefined) return whisperBinCache;

  const result = await new Promise<WhisperBinInfo | null>((resolve) => {
    // Check whisper-cpp first
    exec("which whisper-cpp", (err, stdout) => {
      if (!err && stdout.trim()) {
        // Find a model file for whisper-cpp
        const modelPaths = [
          join(process.env.HOME || "", ".cache", "whisper-cpp", "ggml-base.en.bin"),
          join(process.env.HOME || "", ".cache", "whisper-cpp", "ggml-base.bin"),
          "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin",
          "/usr/local/share/whisper-cpp/models/ggml-base.en.bin",
        ];
        // For now, just check python whisper which we know exists
        exec("which whisper", (err2, stdout2) => {
          if (!err2 && stdout2.trim()) {
            resolve({ path: stdout2.trim(), type: "python" });
            return;
          }
          // Try cpp with model
          for (const mp of modelPaths) {
            try {
              resolve({ path: stdout.trim(), type: "cpp", modelPath: mp });
              return;
            } catch { /* continue */ }
          }
          resolve(null);
        });
        return;
      }

      // Check python whisper
      exec("which whisper", (err2, stdout2) => {
        if (!err2 && stdout2.trim()) {
          resolve({ path: stdout2.trim(), type: "python" });
          return;
        }
        resolve(null);
      });
    });
  });

  whisperBinCache = result;
  return result;
}

let whisperBinCache: WhisperBinInfo | null | undefined = undefined;

/**
 * Try OpenAI Whisper API.
 * Returns transcribed text or null on failure.
 */
async function tryOpenAIWhisper(audio: Blob): Promise<string | null> {
  try {
    const whisperForm = new FormData();
    whisperForm.append("file", audio, "audio.webm");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("language", "en");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: whisperForm,
      }
    );

    if (!response.ok) {
      console.error("[api/stt] OpenAI error:", response.status);
      return null;
    }

    const result = await response.json();
    return result.text || null;
  } catch (err) {
    console.error("[api/stt] OpenAI whisper failed:", err);
    return null;
  }
}
