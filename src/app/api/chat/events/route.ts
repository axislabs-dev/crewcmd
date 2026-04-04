import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { subscribeChatEvents } from "@/lib/chat-pubsub";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, and, gt, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/events?companyId=xxx&since=<ISO timestamp>
 *
 * SSE endpoint that streams chat message events for a company.
 * On connect: sends any messages newer than `since`.
 * Then: streams new messages as they are persisted in real-time.
 * Heartbeat ping every 30s to keep connection alive.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId") ||
    request.cookies.get("active_company")?.value || "";
  const since = searchParams.get("since");

  if (!companyId) {
    return Response.json({ error: "companyId required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send any messages newer than `since`
      const sendCatchup = async () => {
        if (!db || !since) return;
        try {
          const sinceDate = new Date(since);
          // Get all sessions for this company
          const sessions = await withRetry(() =>
            db!.select({ id: chatSessions.id, agentId: chatSessions.agentId })
              .from(chatSessions)
              .where(eq(chatSessions.companyId, companyId))
          );

          for (const session of sessions) {
            const msgs = await withRetry(() =>
              db!.select().from(chatMessages)
                .where(
                  and(
                    eq(chatMessages.sessionId, session.id),
                    gt(chatMessages.createdAt, sinceDate),
                  )
                )
                .orderBy(asc(chatMessages.createdAt))
                .limit(200)
            );

            for (const m of msgs) {
              if (closed) return;
              const event = JSON.stringify({
                type: "message",
                id: m.id,
                sessionId: session.id,
                agentId: session.agentId,
                companyId,
                role: m.role,
                content: m.content,
                metadata: m.metadata,
                createdAt: m.createdAt.toISOString(),
              });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
          }
        } catch (err) {
          console.error("[api/chat/events] Catchup error:", err);
        }
      };

      sendCatchup();

      // 2. Subscribe to real-time events
      const unsubscribe = subscribeChatEvents((event) => {
        if (closed || event.companyId !== companyId) return;
        const data = JSON.stringify({ type: "message", ...event });
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      });

      // 3. Heartbeat ping every 30s
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Store cleanup references on the controller for the cancel handler
      (controller as unknown as Record<string, unknown>).__cleanup = () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    },
    cancel(controller) {
      const cleanup = (controller as unknown as Record<string, unknown>).__cleanup as (() => void) | undefined;
      if (cleanup) cleanup();
      else closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
