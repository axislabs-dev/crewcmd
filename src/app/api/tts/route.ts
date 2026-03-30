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
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string") {
      return Response.json(
        { error: "text string is required" },
        { status: 400 }
      );
    }

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
      const errorText = await response.text();
      console.error("[api/tts] OpenAI error:", response.status, errorText);
      return Response.json(
        { error: "TTS error", details: errorText },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[api/tts] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
