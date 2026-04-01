import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient } from "@/lib/gateway-chat-pool";

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

    // Get the last user message
    const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    if (!lastUserMessage) {
      return Response.json(
        { error: "No user message found" },
        { status: 400 }
      );
    }

    const client = await getGatewayClient();

    // Derive a session key from agent to maintain context
    const agentId = agent || "main";
    const sessionKey = `crewcmd:${agentId}`;

    // Set up SSE stream
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        // Client disconnected, clean up event listener
        client.off("chat", chatHandler);
      },
    });

    let done = false;

    const chatHandler = (payload: unknown) => {
      const p = payload as Record<string, unknown>;
      const text = (p.text as string) || (p.delta as string) || "";
      const isComplete = p.done === true || p.status === "complete" || p.status === "done";

      if (text && streamController) {
        const chunk = JSON.stringify({
          choices: [{ delta: { content: text } }],
        });
        streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }

      if (isComplete && streamController && !done) {
        done = true;
        streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController.close();
        client.off("chat", chatHandler);
      }
    };

    client.on("chat", chatHandler);

    // Send the message
    try {
      await client.chatSend({
        message: lastUserMessage.content,
        agentId,
        sessionKey,
      });
    } catch (err) {
      client.off("chat", chatHandler);
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: `Gateway error: ${msg}` },
        { status: 502 }
      );
    }

    // Safety timeout - if no [DONE] in 5 minutes, close the stream
    setTimeout(() => {
      if (!done && streamController) {
        done = true;
        try {
          streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
          streamController.close();
        } catch { /* already closed */ }
        client.off("chat", chatHandler);
      }
    }, 300_000);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[api/chat] Error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    if (msg === "No runtime configured") {
      return Response.json(
        { error: "No runtime configured. Connect an OpenClaw Gateway in Settings." },
        { status: 503 }
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
