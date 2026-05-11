import { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, and, asc, desc, isNull, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import { buildChatExecutionSnapshot, loadChatExecutionEvents } from "@/lib/chat-session-events";

/**
 * GET /api/chat/messages?sessionId=xxx&limit=100
 * GET /api/chat/messages?agentId=neo&companyId=xxx&limit=100
 * GET /api/chat/messages?companyId=xxx&sessionKey=neo:abc&limit=100
 * GET /api/chat/messages?companyId=xxx&threadParentSessionKey=neo:abc&limit=100
 *
 * Fetch messages for a chat session, oldest first.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");
  const sessionKey = searchParams.get("sessionKey");
  const threadParentSessionKey = searchParams.get("threadParentSessionKey");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

  if (!sessionId && !((agentId || sessionKey) && companyId) && !(threadParentSessionKey && companyId)) {
    return Response.json({ error: "sessionId or ((agentId or sessionKey) + companyId) required" }, { status: 400 });
  }

  try {
    if (threadParentSessionKey && companyId) {
      const threadPrefix = `${threadParentSessionKey}:thread:`;
      const threadSessions = await withRetry(() =>
        db!.select({
          id: chatSessions.id,
          agentId: chatSessions.agentId,
          gatewaySessionKey: chatSessions.gatewaySessionKey,
        }).from(chatSessions)
          .where(and(
            eq(chatSessions.companyId, companyId),
            sql`${chatSessions.gatewaySessionKey} like ${`${threadPrefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`} escape '\\'`
          ))
          .orderBy(asc(chatSessions.gatewaySessionKey))
          .limit(200)
      );

      const threads = await Promise.all(
        threadSessions
          .filter((session) => session.gatewaySessionKey)
          .map(async (session) => {
            const messages = await withRetry(() =>
              db!.select().from(chatMessages)
                .where(eq(chatMessages.sessionId, session.id))
                .orderBy(asc(chatMessages.createdAt))
                .limit(limit)
            );
            return {
              sessionId: session.id,
              agentId: session.agentId,
              sessionKey: session.gatewaySessionKey,
              messages: messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.createdAt,
                metadata: m.metadata,
              })),
            };
          })
      );

      return Response.json({ threads });
    }

    let resolvedSessionId = sessionId;

    if (!resolvedSessionId && sessionKey && companyId) {
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(eq(chatSessions.gatewaySessionKey, sessionKey), eq(chatSessions.companyId, companyId)))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
      }
    }

    if (!resolvedSessionId && agentId && companyId) {
      const agentLower = agentId.toLowerCase();
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(eq(chatSessions.gatewaySessionKey, agentLower), eq(chatSessions.companyId, companyId)))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
      }
    }

    if (!resolvedSessionId && agentId && companyId) {
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.agentId, agentId.toLowerCase()),
            eq(chatSessions.companyId, companyId),
            isNull(chatSessions.gatewaySessionKey)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
      }
    }

    if (!resolvedSessionId) {
      return Response.json({ messages: [], sessionId: null, execution: { progress: null, events: [] } });
    }

    const messages = await withRetry(() =>
      db!.select().from(chatMessages)
        .where(eq(chatMessages.sessionId, resolvedSessionId!))
        .orderBy(asc(chatMessages.createdAt))
        .limit(limit)
    );
    const execution = buildChatExecutionSnapshot(
      await loadChatExecutionEvents(resolvedSessionId!, 200)
    );

    return Response.json({
      sessionId: resolvedSessionId,
      execution,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        metadata: m.metadata,
      })),
    });
  } catch (error) {
    console.error("[api/chat/messages] Error:", error);
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * DELETE /api/chat/messages
 *
 * Clear persisted CrewCmd messages for a session. Keeps the session row so a
 * deliberate empty thread does not immediately fall back to gateway history.
 * Body: { sessionId: string } OR { agentId: string, companyId: string }
 */
export async function DELETE(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  try {
    const body = await request.json() as {
      sessionId?: string;
      agentId?: string;
      companyId?: string;
      gatewaySessionKey?: string;
    };

    let sessionId = body.sessionId;

    if (!sessionId && body.agentId && body.companyId) {
      const conditions = [
        eq(chatSessions.agentId, body.agentId.toLowerCase()),
        eq(chatSessions.companyId, body.companyId),
      ];
      if (body.gatewaySessionKey) {
        conditions.push(eq(chatSessions.gatewaySessionKey, body.gatewaySessionKey));
      }

      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(...conditions))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length === 0) {
        return Response.json({ cleared: 0, sessionId: null });
      }

      sessionId = sessions[0].id;
    }

    if (!sessionId) {
      return Response.json(
        { error: "sessionId or (agentId + companyId) required" },
        { status: 400 }
      );
    }

    const deleted = await withRetry(() =>
      db!.delete(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId!))
        .returning({ id: chatMessages.id })
    );

    await withRetry(() =>
      db!.update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId!))
    );

    return Response.json({ cleared: deleted.length, sessionId });
  } catch (error) {
    console.error("[api/chat/messages] Clear error:", error);
    return Response.json({ error: "Failed to clear messages" }, { status: 500 });
  }
}

/**
 * POST /api/chat/messages
 *
 * Save a message to a chat session. Creates session on-the-fly if needed.
 * Body: { sessionId: string, role: "user"|"assistant"|"system", content: string, metadata?: object }
 *   OR: { agentId: string, companyId: string, role: ..., content: ..., metadata?: ... }
 *       (auto-creates or reuses the latest session for that agent)
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return Response.json({ error: "Database not initialized" }, { status: 500 });
  }

  try {
    const body = await request.json() as {
      sessionId?: string;
      agentId?: string;
      companyId?: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.role || !body.content) {
      return Response.json({ error: "role and content required" }, { status: 400 });
    }

    let sessionId = body.sessionId;

    // Auto-resolve session: find or create for this agent
    if (!sessionId && body.agentId && body.companyId) {
      const agentLower = body.agentId.toLowerCase();

      // Find most recent session for this agent
      const existing = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(eq(chatSessions.agentId, agentLower), eq(chatSessions.companyId, body.companyId!)))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (existing.length > 0) {
        sessionId = existing[0].id;
      } else {
        // Create a new session
        const [newSession] = await withRetry(() =>
          db!.insert(chatSessions).values({
            companyId: body.companyId!,
            agentId: agentLower,
          }).returning()
        );
        sessionId = newSession.id;
      }
    }

    if (!sessionId) {
      return Response.json(
        { error: "sessionId or (agentId + companyId) required" },
        { status: 400 }
      );
    }

    // Insert message
    const [message] = await withRetry(() =>
      db!.insert(chatMessages).values({
        sessionId,
        role: body.role,
        content: body.content,
        metadata: body.metadata || null,
      }).returning()
    );

    // Touch session updatedAt
    await withRetry(() =>
      db!.update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId!))
    );

    return Response.json({ message, sessionId }, { status: 201 });
  } catch (error) {
    console.error("[api/chat/messages] Save error:", error);
    return Response.json({ error: "Failed to save message" }, { status: 500 });
  }
}
