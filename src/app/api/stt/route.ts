import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!OPENAI_API_KEY) {
    return Response.json(
      { error: "OpenAI API key not configured" },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!audio || !(audio instanceof Blob)) {
      return Response.json(
        { error: "audio file is required" },
        { status: 400 }
      );
    }

    const whisperForm = new FormData();
    whisperForm.append("file", audio, "audio.webm");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("language", "en");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: whisperForm,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[api/stt] OpenAI error:", response.status, errorText);
      return Response.json(
        { error: "STT error", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return Response.json({ text: result.text });
  } catch (error) {
    console.error("[api/stt] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
