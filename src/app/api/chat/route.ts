import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { messages, agent } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const runtime = await withRetry(() =>
      db!.query.companyRuntimes.findFirst({
        where: eq(companyRuntimes.isPrimary, true),
      })
    );

    if (!runtime?.httpUrl) {
      return Response.json(
        { error: "No runtime configured. Connect an OpenClaw Gateway in Settings." },
        { status: 503 }
      );
    }

    const gatewayUrl = runtime.httpUrl.replace(/\/+$/, "");
    const gatewayToken = runtime.authToken || "";

    const model = agent ? `openclaw:${agent}` : "openclaw:main";

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[api/chat] Gateway error:", response.status, errorText);
      return Response.json(
        { error: "Gateway error", details: errorText },
        { status: response.status }
      );
    }

    // Stream the response back
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[api/chat] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
