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

    // Use the agent's session key — "main" for default, agent callsign for specific agents
    const agentId = agent || "main";
    const sessionKey = agentId === "main" ? "main" : agentId;

    // Set up SSE stream
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;
    const cleanupFns: Array<() => void> = [];

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        // Client disconnected, clean up event listeners
        for (const fn of cleanupFns) fn();
      },
    });

    let done = false;
    let lastStreamedText = "";

    // Extract text content from a gateway chat message object
    // Handles: string, { content: string }, { text: string }, 
    // { content: [{ type: "text", text: "..." }] }
    function extractText(message: unknown): string {
      if (typeof message === "string") return message;
      if (!message || typeof message !== "object") return "";
      const msg = message as Record<string, unknown>;

      // Try content array format: { role, content: [{ type: "text", text: "..." }] }
      if (Array.isArray(msg.content)) {
        return (msg.content as Array<Record<string, unknown>>)
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("");
      }

      // Try plain text/content field
      if (typeof msg.content === "string") return msg.content;
      if (typeof msg.text === "string") return msg.text;

      return "";
    }

    const chatHandler = (payload: unknown) => {
      if (!streamController || done) return;
      const p = payload as Record<string, unknown>;

      // Filter: only handle events for THIS session (prevents cross-agent bleed)
      // Gateway may use full session keys like "agent:main:neo" while we send "NEO"
      const eventSession = ((p.sessionKey as string) || (p.session as string) || "").toLowerCase();
      const ourSession = sessionKey.toLowerCase();
      console.log(`[api/chat] Event received: state="${p.state}" eventSession="${eventSession}" ourSession="${ourSession}" keys=${Object.keys(p).join(",")}`);

      if (eventSession && eventSession !== ourSession) {
        // Check if our sessionKey is a suffix of the gateway's full session key
        const isMatch = eventSession.endsWith(`:${ourSession}`) || eventSession === ourSession;
        if (!isMatch) {
          console.log(`[api/chat] Skipping event for session "${eventSession}" (ours: "${ourSession}")`);
          return;
        }
      }

      const state = p.state as string;

      if (state === "delta") {
        // Delta events contain cumulative text (full text so far)
        const fullText = extractText(p.message);
        if (fullText && fullText.length > lastStreamedText.length) {
          const newContent = fullText.slice(lastStreamedText.length);
          lastStreamedText = fullText;
          const chunk = JSON.stringify({
            choices: [{ delta: { content: newContent } }],
          });
          streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
      } else if (state === "final") {
        // Final event — send any remaining text and close
        const finalText = extractText(p.message);
        if (finalText && finalText.length > lastStreamedText.length) {
          const remaining = finalText.slice(lastStreamedText.length);
          const chunk = JSON.stringify({
            choices: [{ delta: { content: remaining } }],
          });
          streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        done = true;
        streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController.close();
        client.off("chat", chatHandler);
      } else if (state === "aborted") {
        done = true;
        streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController.close();
        client.off("chat", chatHandler);
      } else if (state === "error") {
        const errorMsg = (p.errorMessage as string) || "Chat error";
        const chunk = JSON.stringify({
          choices: [{ delta: { content: `\n\nError: ${errorMsg}` } }],
        });
        streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        done = true;
        streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController.close();
        client.off("chat", chatHandler);
      }
    };

    // Debug: log ALL gateway events to find the right event name
    const debugHandler = (payload: unknown) => {
      const p = payload as Record<string, string>;
      console.log(`[api/chat] [debug-wildcard] event="${p.event}" state="${p.state}" sessionKey="${p.sessionKey}" keys=${Object.keys(p).join(",")}`);
    };
    client.on("*", debugHandler);
    client.on("chat", chatHandler);
    cleanupFns.push(() => {
      client.off("chat", chatHandler);
      client.off("*", debugHandler);
    });

    // Send the message
    try {
      await client.chatSend({
        message: lastUserMessage.content,
        sessionKey,
      });
    } catch (err) {
      client.off("chat", chatHandler);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[api/chat] chat.send failed:", msg);
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
        client.off("*", debugHandler);
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
