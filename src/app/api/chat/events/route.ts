import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveAccessibleWorkspace } from "@/lib/workspace";
import { subscribeChatEvents } from "@/lib/chat-pubsub";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessionEvents, chatSessions } from "@/db/schema";
import { eq, and, gt, asc } from "drizzle-orm";
import { canAccessChatSession } from "@/lib/chat-session-access";
import {
  loadRealtimeEventBySequence,
  loadRealtimeEventsAfterCursor,
  normalizeRealtimeCursor,
  toClientRealtimeEvent,
  type RealtimeEventRow,
} from "@/lib/realtime-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/events?companyId=xxx&lastEventId=<sequence>
 *
 * SSE endpoint that streams durable chat sync events for a company.
 * On connect: replays realtime_events after the cursor.
 * Then: streams new committed events as they are persisted in real-time.
 * Heartbeat ping every 30s to keep connection alive.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId") ||
    request.cookies.get("active_company")?.value || "";
  const lastEventId = normalizeRealtimeCursor(
    request.headers.get("Last-Event-ID") ?? searchParams.get("lastEventId")
  );
  const since = searchParams.get("since");

  if (!companyId) {
    return Response.json({ error: "companyId required" }, { status: 400 });
  }

  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitCompanyId: companyId,
    requireExplicitForBearer: true,
  });
  if (!workspace) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | undefined;
  const sessionAccessCache = new Map<string, Promise<boolean>>();
  const canReadSession = (session: typeof chatSessions.$inferSelect) => {
    let cached = sessionAccessCache.get(session.id);
    if (!cached) {
      cached = canAccessChatSession(request, session);
      sessionAccessCache.set(session.id, cached);
    }
    return cached;
  };
  const canReadSessionId = (sessionId: string) => {
    let cached = sessionAccessCache.get(sessionId);
    if (!cached) {
      cached = withRetry(async () => {
        const [session] = await db!.select().from(chatSessions)
          .where(eq(chatSessions.id, sessionId))
          .limit(1);
        return session ? canAccessChatSession(request, session) : false;
      });
      sessionAccessCache.set(sessionId, cached);
    }
    return cached;
  };
  const sendRealtimeEvent = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: RealtimeEventRow,
  ) => {
    if (closed || event.companyId !== companyId) return;
    if (event.sessionId && !(await canReadSessionId(event.sessionId))) return;

    const data = JSON.stringify(toClientRealtimeEvent(event));
    controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${data}\n\n`));
  };

  const stream = new ReadableStream({
    start(controller) {
      // 1. Replay durable events after the cursor. Fall back to legacy timestamp catch-up.
      const sendCatchup = async () => {
        if (!db) return;
        try {
          if (lastEventId !== null) {
            const events = await loadRealtimeEventsAfterCursor({ companyId, lastEventId });
            for (const event of events) {
              if (closed) return;
              await sendRealtimeEvent(controller, event);
            }
            return;
          }

          if (!since) return;
          const sinceDate = new Date(since);
          // Get all sessions for this company
          const sessions = await withRetry(() =>
            db!.select()
              .from(chatSessions)
              .where(eq(chatSessions.companyId, companyId))
          );

          for (const session of sessions) {
            if (!(await canReadSession(session))) continue;
            const [msgs, progressEvents] = await Promise.all([
              withRetry(() =>
                db!.select().from(chatMessages)
                  .where(
                    and(
                      eq(chatMessages.sessionId, session.id),
                      gt(chatMessages.createdAt, sinceDate),
                    )
                  )
                  .orderBy(asc(chatMessages.createdAt))
                  .limit(200)
              ),
              withRetry(() =>
                db!.select().from(chatSessionEvents)
                  .where(
                    and(
                      eq(chatSessionEvents.sessionId, session.id),
                      gt(chatSessionEvents.createdAt, sinceDate),
                    )
                  )
                  .orderBy(asc(chatSessionEvents.createdAt))
                  .limit(200)
              ),
            ]);

            const events = [
              ...msgs.map((m) => ({
                order: m.createdAt.getTime(),
                data: {
                  type: "message",
                  id: m.id,
                  sessionId: session.id,
                  agentId: session.agentId,
                  companyId,
                  sessionKey: session.gatewaySessionKey,
                  channelId: session.channelId,
                  role: m.role,
                  content: m.content,
                  metadata: m.metadata,
                  createdAt: m.createdAt.toISOString(),
                },
              })),
              ...progressEvents.map((m) => ({
                order: m.createdAt.getTime(),
                data: {
                  ...(m.payload as Record<string, unknown>),
                  type: "chat_progress",
                  sessionId: session.id,
                  agentId: session.agentId,
                  companyId,
                  sessionKey: (m.payload as Record<string, unknown>).sessionKey ?? m.gatewaySessionKey,
                  channelId: session.channelId,
                },
              })),
            ].sort((a, b) => a.order - b.order);

            for (const event of events) {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
            }
          }
        } catch (err) {
          console.error("[api/chat/events] Catchup error:", err);
        }
      };

      sendCatchup();

      // 2. Subscribe to committed realtime event descriptors
      const unsubscribe = subscribeChatEvents((event) => {
        if (closed || event.companyId !== companyId) return;
        void loadRealtimeEventBySequence(event.sequence).then(async (realtimeEvent) => {
          if (!realtimeEvent || closed) return;
          try {
            await sendRealtimeEvent(controller, realtimeEvent);
          } catch {
            // Stream closed
          }
        }).catch((err) => {
          console.error("[api/chat/events] Subscription replay error:", err);
        });
      });

      // 3. Heartbeat ping every 30s
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: ping ${new Date().toISOString()}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      cleanup = () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      if (cleanup) cleanup();
      else closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
