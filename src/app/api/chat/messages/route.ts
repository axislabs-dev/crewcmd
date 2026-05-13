import { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import { buildChatExecutionSnapshot, loadChatExecutionEvents } from "@/lib/chat-session-events";
import { loadThreadHistoryForParent, type ChatPersistenceScope } from "@/lib/chat-thread-history";
import { resolveAccessibleWorkspace, type WorkspaceRecord } from "@/lib/workspace";

type ChatSessionRecord = typeof chatSessions.$inferSelect;

async function getReadableChatWorkspace(
  request: NextRequest,
  scope: ChatPersistenceScope
): Promise<WorkspaceRecord | null> {
  if (!scope.workspaceId && !scope.companyId) return null;
  return resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: scope.workspaceId ?? null,
    explicitCompanyId: scope.workspaceId ? null : scope.companyId ?? null,
    requireExplicitForBearer: true,
  });
}

async function loadVisibleChatSessionById(
  request: NextRequest,
  sessionId: string
): Promise<ChatSessionRecord | "forbidden" | null> {
  const [session] = await withRetry(() =>
    db!
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)
  );

  if (!session) return null;

  // Privacy-first: a chat session without an explicit workspace binding is
  // ambiguous, even if it has a companyId. Do not make legacy/private chats
  // visible to every company member by inferring broad company access.
  if (!session.workspaceId) return "forbidden";

  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: session.workspaceId,
    requireExplicitForBearer: true,
  });

  return workspace?.id === session.workspaceId ? session : "forbidden";
}

/**
 * GET /api/chat/messages?sessionId=xxx&limit=100
 * GET /api/chat/messages?agentId=agent-callsign&companyId=xxx&limit=100
 * GET /api/chat/messages?companyId=xxx&sessionKey=runtime-session-key&limit=100
 * GET /api/chat/messages?companyId=xxx&threadParentSessionKey=runtime-session-key&limit=100
 * GET /api/chat/messages?workspaceId=xxx&sessionKey=runtime-session-key&limit=100
 * GET /api/chat/messages?workspaceId=xxx&threadParentSessionKey=runtime-session-key&limit=100
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
  const workspaceId = searchParams.get("workspaceId");
  const sessionKey = searchParams.get("sessionKey");
  const threadParentSessionKey = searchParams.get("threadParentSessionKey");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const scope: ChatPersistenceScope = { companyId, workspaceId };
  const hasScope = Boolean(companyId || workspaceId);

  if (!sessionId && !((agentId || sessionKey) && hasScope) && !(threadParentSessionKey && hasScope)) {
    return Response.json({ error: "sessionId or ((agentId or sessionKey) + companyId/workspaceId) required" }, { status: 400 });
  }

  try {
    const readableWorkspace = hasScope
      ? await getReadableChatWorkspace(request, scope)
      : null;

    if (threadParentSessionKey && hasScope) {
      if (!readableWorkspace) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      return Response.json(await loadThreadHistoryForParent(threadParentSessionKey, { workspaceId: readableWorkspace.id }, limit));
    }

    let resolvedSessionId = sessionId;
    let resolvedSessionKey = sessionKey;
    let resolvedSession: ChatSessionRecord | null = null;

    if (resolvedSessionId) {
      const visibleSession = await loadVisibleChatSessionById(request, resolvedSessionId);
      if (visibleSession === "forbidden") {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!visibleSession) {
        resolvedSessionId = null;
      } else {
        resolvedSession = visibleSession;
        resolvedSessionKey = visibleSession.gatewaySessionKey ?? resolvedSessionKey;
      }
    }

    if (!resolvedSessionId && sessionKey && hasScope) {
      if (!readableWorkspace) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.gatewaySessionKey, sessionKey),
            eq(chatSessions.workspaceId, readableWorkspace.id)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? sessionKey;
        resolvedSession = sessions[0];
      }
    }

    if (!resolvedSessionId && agentId && hasScope) {
      if (!readableWorkspace) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const agentLower = agentId.toLowerCase();
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.gatewaySessionKey, agentLower),
            eq(chatSessions.workspaceId, readableWorkspace.id)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? agentLower;
        resolvedSession = sessions[0];
      }
    }

    if (!resolvedSessionId && agentId && hasScope) {
      if (!readableWorkspace) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.agentId, agentId.toLowerCase()),
            eq(chatSessions.workspaceId, readableWorkspace.id),
            isNull(chatSessions.gatewaySessionKey)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? null;
        resolvedSession = sessions[0];
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
    const threadWorkspaceId = resolvedSession?.workspaceId ?? readableWorkspace?.id ?? null;
    const threadHistory = threadWorkspaceId && resolvedSessionKey && !resolvedSessionKey.toLowerCase().includes(":thread:")
      ? await loadThreadHistoryForParent(resolvedSessionKey, { workspaceId: threadWorkspaceId }, limit)
      : { threads: [], threadSummaries: {}, threadIndex: {} };

    return Response.json({
      sessionId: resolvedSessionId,
      execution,
      ...threadHistory,
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
 * Body: { sessionId: string } OR { agentId: string, companyId?: string, workspaceId?: string }
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
      workspaceId?: string;
      gatewaySessionKey?: string;
    };

    let sessionId = body.sessionId;

    if (!sessionId && body.agentId && (body.companyId || body.workspaceId)) {
      const conditions = [
        eq(chatSessions.agentId, body.agentId.toLowerCase()),
        body.companyId ? eq(chatSessions.companyId, body.companyId) : eq(chatSessions.workspaceId, body.workspaceId!),
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
        { error: "sessionId or (agentId + companyId/workspaceId) required" },
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
 *   OR: { agentId: string, companyId?: string, workspaceId?: string, role: ..., content: ..., metadata?: ... }
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
      workspaceId?: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.role || !body.content) {
      return Response.json({ error: "role and content required" }, { status: 400 });
    }

    let sessionId = body.sessionId;

    // Auto-resolve session: find or create for this agent
    if (!sessionId && body.agentId && (body.companyId || body.workspaceId)) {
      const agentLower = body.agentId.toLowerCase();

      // Find most recent session for this agent
      const existing = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.agentId, agentLower),
            body.companyId ? eq(chatSessions.companyId, body.companyId) : eq(chatSessions.workspaceId, body.workspaceId!)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (existing.length > 0) {
        sessionId = existing[0].id;
      } else {
        // Create a new session
        const [newSession] = await withRetry(() =>
          db!.insert(chatSessions).values({
            companyId: body.companyId ?? null,
            workspaceId: body.workspaceId ?? null,
            agentId: agentLower,
          }).returning()
        );
        sessionId = newSession.id;
      }
    }

    if (!sessionId) {
      return Response.json(
        { error: "sessionId or (agentId + companyId/workspaceId) required" },
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
