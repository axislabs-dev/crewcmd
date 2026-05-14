import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, withRetry } from "@/db";
import { chatMessagePins, chatMessages, chatSessions } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveAccessibleWorkspace } from "@/lib/workspace";
import { canAccessChatSession } from "@/lib/chat-session-access";

export const dynamic = "force-dynamic";

function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

async function resolveSessionId(params: {
  request: NextRequest;
  sessionId?: string | null;
  sessionKey?: string | null;
  companyId?: string | null;
  workspaceId?: string | null;
}): Promise<{ sessionId: string | null; allowed: boolean } | null> {
  if (params.sessionId) {
    const { session, allowed } = await loadAccessibleSessionById(params.request, params.sessionId);
    return { sessionId: session?.id ?? null, allowed };
  }
  if (!params.sessionKey || (!params.companyId && !params.workspaceId)) return null;

  const workspace = await resolveAccessibleWorkspace({
    request: params.request,
    explicitWorkspaceId: params.workspaceId ?? null,
    explicitCompanyId: params.companyId ?? null,
    requireExplicitForBearer: true,
  });
  if (!workspace) return { sessionId: null, allowed: false };

  const rows = await withRetry(() =>
    db!.select().from(chatSessions)
      .where(and(
        eq(chatSessions.gatewaySessionKey, params.sessionKey!),
        workspace.companyId
          ? eq(chatSessions.companyId, workspace.companyId)
          : eq(chatSessions.workspaceId, workspace.id)
      ))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(1)
  );
  const session = rows[0] ?? null;
  if (!session) return { sessionId: null, allowed: true };
  return { sessionId: session.id, allowed: await canAccessChatSession(params.request, session) };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const resolved = await resolveSessionId({
    request,
    sessionId: searchParams.get("sessionId"),
    sessionKey: searchParams.get("sessionKey"),
    companyId: searchParams.get("companyId"),
    workspaceId: searchParams.get("workspaceId"),
  });
  if (!resolved) return NextResponse.json({ pins: [] });
  if (!resolved.allowed) return forbiddenResponse();

  const { sessionId } = resolved;
  if (!sessionId) return NextResponse.json({ pins: [] });

  const pins = await withRetry(() =>
    db!.select({
      id: chatMessagePins.id,
      messageId: chatMessagePins.messageId,
      pinnedByUserId: chatMessagePins.pinnedByUserId,
      createdAt: chatMessagePins.createdAt,
      role: chatMessages.role,
      content: chatMessages.content,
      messageCreatedAt: chatMessages.createdAt,
      metadata: chatMessages.metadata,
      agentId: chatSessions.agentId,
      gatewaySessionKey: chatSessions.gatewaySessionKey,
    })
      .from(chatMessagePins)
      .innerJoin(chatMessages, eq(chatMessagePins.messageId, chatMessages.id))
      .innerJoin(chatSessions, eq(chatMessagePins.sessionId, chatSessions.id))
      .where(eq(chatMessagePins.sessionId, sessionId))
      .orderBy(desc(chatMessagePins.createdAt))
      .limit(3)
  );

  return NextResponse.json({ pins });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const session = await auth();
  const userId = (session?.user as Record<string, unknown> | undefined)?.id as string | undefined;
  const body = await request.json() as { messageId?: string; companyId?: string | null; workspaceId?: string | null };
  if (!body.messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const [message] = await withRetry(() =>
    db!.select({
      id: chatMessages.id,
      sessionId: chatMessages.sessionId,
      companyId: chatSessions.companyId,
      workspaceId: chatSessions.workspaceId,
      channelId: chatSessions.channelId,
    })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .where(eq(chatMessages.id, body.messageId!))
      .limit(1)
  );

  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (!(await canAccessChatSession(request, message))) return forbiddenResponse();
  if (body.companyId && message.companyId !== body.companyId) {
    return NextResponse.json({ error: "Message not found in company scope" }, { status: 404 });
  }
  if (body.workspaceId && message.workspaceId !== body.workspaceId) {
    return NextResponse.json({ error: "Message not found in workspace scope" }, { status: 404 });
  }

  const [pin] = await withRetry(() =>
    db!.insert(chatMessagePins)
      .values({
        companyId: message.companyId,
        workspaceId: message.workspaceId,
        sessionId: message.sessionId,
        messageId: message.id,
        pinnedByUserId: userId ?? null,
      })
      .onConflictDoUpdate({
        target: chatMessagePins.messageId,
        set: { pinnedByUserId: userId ?? null },
      })
      .returning()
  );

  const sessionPins = await withRetry(() =>
    db!.select({ id: chatMessagePins.id }).from(chatMessagePins)
      .where(eq(chatMessagePins.sessionId, message.sessionId))
      .orderBy(asc(chatMessagePins.createdAt))
  );
  const overflowPinIds = sessionPins.slice(0, Math.max(0, sessionPins.length - 3)).map((row) => row.id);
  if (overflowPinIds.length > 0) {
    await withRetry(() =>
      db!.delete(chatMessagePins)
        .where(inArray(chatMessagePins.id, overflowPinIds))
    );
  }

  return NextResponse.json({ pin }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const [message] = await withRetry(() =>
    db!.select({
      id: chatMessages.id,
      companyId: chatSessions.companyId,
      workspaceId: chatSessions.workspaceId,
      channelId: chatSessions.channelId,
    })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .where(eq(chatMessages.id, messageId))
      .limit(1)
  );

  if (message && !(await canAccessChatSession(request, message))) return forbiddenResponse();

  const deleted = await withRetry(() =>
    db!.delete(chatMessagePins)
      .where(eq(chatMessagePins.messageId, messageId))
      .returning({ id: chatMessagePins.id })
  );

  return NextResponse.json({ deleted: deleted.length });
}
