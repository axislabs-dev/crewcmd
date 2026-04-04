import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient, holdClient, releaseClient } from "@/lib/gateway-chat-pool";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { publishChatEvent } from "@/lib/chat-pubsub";

export const dynamic = "force-dynamic";

/**
 * Find-or-create a chat session for an agent+company pair.
 * Returns the session ID.
 */
async function resolveSessionId(agentId: string, companyId: string): Promise<string> {
  const agentLower = agentId.toLowerCase();

  const existing = await withRetry(() =>
    db!.select().from(chatSessions)
      .where(and(eq(chatSessions.agentId, agentLower), eq(chatSessions.companyId, companyId)))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(1)
  );

  if (existing.length > 0) return existing[0].id;

  const [newSession] = await withRetry(() =>
    db!.insert(chatSessions).values({
      companyId,
      agentId: agentLower,
    }).returning()
  );
  return newSession.id;
}

/**
 * Persist a message to the DB and publish to the event bus.
 * Returns the DB record.
 */
async function persistAndPublish(
  sessionId: string,
  agentId: string,
  companyId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown> | null,
  interrupted?: boolean,
) {
  const [message] = await withRetry(() =>
    db!.insert(chatMessages).values({
      sessionId,
      role,
      content,
      metadata: metadata || null,
    }).returning()
  );

  // Touch session updatedAt
  await withRetry(() =>
    db!.update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId))
  );

  publishChatEvent({
    id: message.id,
    sessionId,
    agentId: agentId.toLowerCase(),
    companyId,
    role,
    content,
    metadata: metadata || null,
    createdAt: message.createdAt.toISOString(),
    interrupted,
  });

  return message;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { messages, agent, companyId: bodyCompanyId } = body;

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

    const agentId = agent || "main";
    const sessionKey = agentId === "main" ? "main" : agentId;

    // Resolve company ID from body or cookie
    const companyId = bodyCompanyId ||
      request.cookies.get("active_company")?.value ||
      "";

    // --- Server-side persistence: persist user message BEFORE sending to gateway ---
    let userMessageId: string | null = null;
    let sessionId: string | null = null;

    if (db && companyId) {
      try {
        sessionId = await resolveSessionId(agentId, companyId);
        const userMsg = await persistAndPublish(
          sessionId,
          agentId,
          companyId,
          "user",
          lastUserMessage.content,
          body.metadata || null,
        );
        userMessageId = userMsg.id;
      } catch (err) {
        console.error("[api/chat] Failed to persist user message:", err);
        // Continue — gateway chat still works without DB
      }
    }

    const client = await getGatewayClient();
    holdClient(client);

    // Set up SSE stream
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;
    const cleanupFns: Array<() => void> = [];

    let done = false;
    let clientDisconnected = false;
    let lastStreamedText = "";
    let fullAssistantText = "";
    let assistantPersisted = false;

    /**
     * Persist the assistant message (called on final, error, abort, cancel, timeout).
     * Guarded to run at most once.
     */
    const persistAssistant = async (interrupted: boolean) => {
      if (assistantPersisted || !db || !sessionId || !companyId) return;
      assistantPersisted = true;
      if (!fullAssistantText) return;

      const content = interrupted
        ? fullAssistantText + "\n\n_(interrupted)_"
        : fullAssistantText;

      try {
        const msg = await persistAndPublish(
          sessionId,
          agentId,
          companyId,
          "assistant",
          content,
          null,
          interrupted,
        );
        // Send assistant message ID to client as a meta event
        if (streamController && !done && !clientDisconnected) {
          const meta = JSON.stringify({ type: "meta", messageId: msg.id, role: "assistant" });
          try {
            streamController.enqueue(encoder.encode(`data: ${meta}\n\n`));
          } catch {
            // Stream may already be closed
          }
        }
      } catch (err) {
        console.error("[api/chat] Failed to persist assistant message:", err);
      }
    };

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;

        // Send user message meta event with DB ID
        if (userMessageId) {
          const meta = JSON.stringify({ type: "meta", messageId: userMessageId, role: "user" });
          controller.enqueue(encoder.encode(`data: ${meta}\n\n`));
        }
      },
      cancel() {
        // Client disconnected (navigation away, abort, etc.)
        // Don't persist or cleanup yet — let the gateway finish naturally.
        // The final/abort/error/timeout handlers will persist the complete
        // response and publish it via SSE so the client sees it on return.
        clientDisconnected = true;
      },
    });

    // Extract text content from a gateway chat message object
    function extractText(message: unknown): string {
      if (typeof message === "string") return message;
      if (!message || typeof message !== "object") return "";
      const msg = message as Record<string, unknown>;

      if (Array.isArray(msg.content)) {
        return (msg.content as Array<Record<string, unknown>>)
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("");
      }

      if (typeof msg.content === "string") return msg.content;
      if (typeof msg.text === "string") return msg.text;

      return "";
    }

    const chatHandler = (payload: unknown) => {
      if (!streamController || done) return;
      const p = payload as Record<string, unknown>;

      // Filter: only handle events for THIS session
      const eventSession = ((p.sessionKey as string) || (p.session as string) || "").toLowerCase();
      const ourSession = sessionKey.toLowerCase();

      if (eventSession && eventSession !== ourSession) {
        const isMatch = eventSession.endsWith(`:${ourSession}`) || eventSession === ourSession;
        if (!isMatch) return;
      }

      const state = p.state as string;

      if (state === "delta") {
        const fullText = extractText(p.message);
        if (fullText && fullText.length > lastStreamedText.length) {
          const newContent = fullText.slice(lastStreamedText.length);
          lastStreamedText = fullText;
          fullAssistantText = fullText;

          if (!clientDisconnected) {
            const chunk = JSON.stringify({
              choices: [{ delta: { content: newContent } }],
            });
            try {
              streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } catch { /* stream closed */ }
          }
        }
      } else if (state === "final") {
        const finalText = extractText(p.message);
        if (finalText && finalText.length > lastStreamedText.length) {
          const remaining = finalText.slice(lastStreamedText.length);
          if (!clientDisconnected) {
            const chunk = JSON.stringify({
              choices: [{ delta: { content: remaining } }],
            });
            try {
              streamController!.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } catch { /* stream closed */ }
          }
        }
        if (finalText) fullAssistantText = finalText;

        // Persist the complete assistant response
        persistAssistant(false).then(() => {
          done = true;
          if (!clientDisconnected) {
            try {
              streamController!.enqueue(encoder.encode("data: [DONE]\n\n"));
              streamController!.close();
            } catch { /* already closed */ }
          }
          client.off("chat", chatHandler);
          releaseClient(client);
        });
      } else if (state === "aborted") {
        persistAssistant(true).then(() => {
          done = true;
          if (!clientDisconnected) {
            try {
              streamController!.enqueue(encoder.encode("data: [DONE]\n\n"));
              streamController!.close();
            } catch { /* already closed */ }
          }
          client.off("chat", chatHandler);
          releaseClient(client);
        });
      } else if (state === "error") {
        const errorMsg = (p.errorMessage as string) || "Chat error";
        if (!clientDisconnected) {
          const chunk = JSON.stringify({
            choices: [{ delta: { content: `\n\nError: ${errorMsg}` } }],
          });
          try {
            streamController!.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          } catch { /* stream closed */ }
        }
        fullAssistantText += `\n\nError: ${errorMsg}`;

        persistAssistant(true).then(() => {
          done = true;
          if (!clientDisconnected) {
            try {
              streamController!.enqueue(encoder.encode("data: [DONE]\n\n"));
              streamController!.close();
            } catch { /* already closed */ }
          }
          client.off("chat", chatHandler);
          releaseClient(client);
        });
      }
    };

    client.on("chat", chatHandler);
    cleanupFns.push(() => {
      client.off("chat", chatHandler);
    });

    // Send the user's message to the gateway
    try {
      await client.chatSend({
        message: lastUserMessage.content,
        sessionKey,
      });
    } catch (err) {
      client.off("chat", chatHandler);
      releaseClient(client);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[api/chat] chat.send failed:", msg);
      return Response.json(
        { error: `Gateway error: ${msg}` },
        { status: 502 }
      );
    }

    // Safety timeout - if no [DONE] in 5 minutes, close the stream
    setTimeout(() => {
      if (!done) {
        persistAssistant(true).then(() => {
          done = true;
          if (!clientDisconnected) {
            try {
              streamController!.enqueue(encoder.encode("data: [DONE]\n\n"));
              streamController!.close();
            } catch { /* already closed */ }
          }
          client.off("chat", chatHandler);
          releaseClient(client);
        });
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
