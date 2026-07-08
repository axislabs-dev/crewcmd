import { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions } from "@/db/schema";
import { resolveAccessibleWorkspace, type WorkspaceRecord } from "@/lib/workspace";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";
import { buildChatExecutionSnapshot, loadChatExecutionEvents } from "@/lib/chat-session-events";
import { loadThreadHistoryForParent, type ChatPersistenceScope } from "@/lib/chat-thread-history";
import { canAccessChatSession } from "@/lib/chat-session-access";
import { appendRealtimeChatMessageEvent } from "@/lib/realtime-events";

function forbiddenResponse() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

async function resolveRequestedChatScope(
  request: NextRequest,
  params: { companyId?: string | null; workspaceId?: string | null; channelId?: string | null }
): Promise<{ workspace: WorkspaceRecord; scope: ChatPersistenceScope } | null> {
  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: params.workspaceId ?? null,
    explicitCompanyId: params.companyId ?? null,
    requireExplicitForBearer: true,
  });
  if (!workspace) return null;
  if (params.channelId && !(await canAccessChatSession(request, {
    companyId: workspace.companyId,
    workspaceId: workspace.id,
    channelId: params.channelId,
  }))) {
    return null;
  }
  return {
    workspace,
    scope: {
      companyId: workspace.companyId,
      workspaceId: workspace.id,
      channelId: params.channelId ?? null,
    },
  };
}

async function loadAccessibleSessionById(request: NextRequest, sessionId: string) {
  const sessions = await withRetry(() =>
    db!.select().from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1)
  );
  const session = sessions[0] ?? null;
  if (!session) return { session: null, allowed: true };
  return { session, allowed: await canAccessChatSession(request, session) };
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
  const channelId = searchParams.get("channelId");
  const threadParentSessionKey = searchParams.get("threadParentSessionKey");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const hasScope = Boolean(companyId || workspaceId);

  if (!sessionId && !((agentId || sessionKey) && hasScope) && !(threadParentSessionKey && hasScope)) {
    return Response.json({ error: "sessionId or ((agentId or sessionKey) + companyId/workspaceId) required" }, { status: 400 });
  }

  try {
    const requestedScope = hasScope
      ? await resolveRequestedChatScope(request, { companyId, workspaceId, channelId })
      : null;
    if (hasScope && !requestedScope) return forbiddenResponse();
    const scope = requestedScope?.scope ?? { companyId: null, workspaceId: null, channelId: null };

    if (threadParentSessionKey && hasScope) {
      return Response.json(await loadThreadHistoryForParent(threadParentSessionKey, scope, limit));
    }

    let resolvedSessionId = sessionId;
    let resolvedSessionKey = sessionKey;
    let sessionAccessChecked = false;
    let resolvedSessionForAccess: typeof chatSessions.$inferSelect | null = null;

    if (resolvedSessionId) {
      const { allowed } = await loadAccessibleSessionById(request, resolvedSessionId);
      if (!allowed) return forbiddenResponse();
      sessionAccessChecked = true;
    }

    if (!resolvedSessionId && sessionKey && hasScope) {
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.gatewaySessionKey, sessionKey),
            scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
            scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? sessionKey;
        resolvedSessionForAccess = sessions[0];
      }
    }

    if (!resolvedSessionId && sessionKey && hasScope) {
      const agentLower = sessionKey.toLowerCase();
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.agentId, agentLower),
            scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
            scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId),
            isNull(chatSessions.gatewaySessionKey)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? sessionKey;
        resolvedSessionForAccess = sessions[0];
      }
    }

    if (!resolvedSessionId && agentId && hasScope) {
      const agentLower = agentId.toLowerCase();
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.gatewaySessionKey, agentLower),
            scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
            scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? agentLower;
        resolvedSessionForAccess = sessions[0];
      }
    }

    if (!resolvedSessionId && agentId && hasScope) {
      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(
            eq(chatSessions.agentId, agentId.toLowerCase()),
            scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
            scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId),
            isNull(chatSessions.gatewaySessionKey)
          ))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length > 0) {
        resolvedSessionId = sessions[0].id;
        resolvedSessionKey = sessions[0].gatewaySessionKey ?? null;
        resolvedSessionForAccess = sessions[0];
      }
    }

    if (!resolvedSessionId) {
      return Response.json({ messages: [], sessionId: null, execution: { progress: null, events: [] } });
    }

    if (!sessionAccessChecked) {
      const allowed = resolvedSessionForAccess
        ? await canAccessChatSession(request, resolvedSessionForAccess)
        : (await loadAccessibleSessionById(request, resolvedSessionId)).allowed;
      if (!allowed) return forbiddenResponse();
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
    const threadHistory = hasScope && resolvedSessionKey && !resolvedSessionKey.toLowerCase().includes(":thread:")
      ? await loadThreadHistoryForParent(resolvedSessionKey, scope, limit)
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
      channelId?: string | null;
      gatewaySessionKey?: string;
    };

    const requestedScope = body.companyId || body.workspaceId
      ? await resolveRequestedChatScope(request, { companyId: body.companyId, workspaceId: body.workspaceId, channelId: body.channelId ?? null })
      : null;
    if ((body.companyId || body.workspaceId) && !requestedScope) return forbiddenResponse();

    let sessionId = body.sessionId;

    if (sessionId) {
      const { allowed } = await loadAccessibleSessionById(request, sessionId);
      if (!allowed) return forbiddenResponse();
    }

    if (!sessionId && body.agentId && (body.companyId || body.workspaceId)) {
      const scope = requestedScope!.scope;
      const conditions = [
        eq(chatSessions.agentId, body.agentId.toLowerCase()),
        scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
      ];
      if (body.gatewaySessionKey) {
        conditions.push(eq(chatSessions.gatewaySessionKey, body.gatewaySessionKey));
      }
      conditions.push(scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId));

      const sessions = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(...conditions))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (sessions.length === 0) {
        return Response.json({ cleared: 0, sessionId: null });
      }
      if (!(await canAccessChatSession(request, sessions[0]))) return forbiddenResponse();

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
      channelId?: string | null;
      gatewaySessionKey?: string;
      sessionKey?: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.role || !body.content) {
      return Response.json({ error: "role and content required" }, { status: 400 });
    }

    const requestedScope = body.companyId || body.workspaceId
      ? await resolveRequestedChatScope(request, { companyId: body.companyId, workspaceId: body.workspaceId, channelId: body.channelId ?? null })
      : null;
    if ((body.companyId || body.workspaceId) && !requestedScope) return forbiddenResponse();

    let sessionId = body.sessionId;
    let resolvedSession: typeof chatSessions.$inferSelect | null = null;

    if (sessionId) {
      const { session, allowed } = await loadAccessibleSessionById(request, sessionId);
      if (!allowed) return forbiddenResponse();
      resolvedSession = session;
    }

    // Auto-resolve session: find or create for this agent
    if (!sessionId && body.agentId && (body.companyId || body.workspaceId)) {
      const agentLower = body.agentId.toLowerCase();
      const gatewaySessionKey = body.gatewaySessionKey ?? body.sessionKey ?? null;

      // Find most recent session for this agent
      const scope = requestedScope!.scope;
      const conditions = [
        eq(chatSessions.agentId, agentLower),
        scope.companyId ? eq(chatSessions.companyId, scope.companyId) : eq(chatSessions.workspaceId, scope.workspaceId!),
        scope.channelId ? eq(chatSessions.channelId, scope.channelId) : isNull(chatSessions.channelId),
      ];
      conditions.push(gatewaySessionKey ? eq(chatSessions.gatewaySessionKey, gatewaySessionKey) : isNull(chatSessions.gatewaySessionKey));
      const existing = await withRetry(() =>
        db!.select().from(chatSessions)
          .where(and(...conditions))
          .orderBy(desc(chatSessions.updatedAt))
          .limit(1)
      );

      if (existing.length > 0) {
        if (!(await canAccessChatSession(request, existing[0]))) return forbiddenResponse();
        sessionId = existing[0].id;
        resolvedSession = existing[0];
      } else {
        // Create a new session
        const [newSession] = await withRetry(() =>
          db!.insert(chatSessions).values({
            companyId: scope.companyId ?? null,
            workspaceId: scope.workspaceId ?? null,
            channelId: scope.channelId ?? null,
            agentId: agentLower,
            gatewaySessionKey,
          }).returning()
        );
        sessionId = newSession.id;
        resolvedSession = newSession;
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

    if (resolvedSession) {
      await appendRealtimeChatMessageEvent({
        session: resolvedSession,
        message,
      });
    }

    return Response.json({ message, sessionId }, { status: 201 });
  } catch (error) {
    console.error("[api/chat/messages] Save error:", error);
    return Response.json({ error: "Failed to save message" }, { status: 500 });
  }
}
