import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, withRetry } from "@/db";
import { chatSessions, chatThreads, tasks, trayPins } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { canAccessChatSession } from "@/lib/chat-session-access";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const TARGET_TYPES = ["task", "chat_session", "chat_thread"] as const;
type TrayPinTargetType = typeof TARGET_TYPES[number];

type TrayPinBody = {
  companyId?: string | null;
  workspaceId?: string | null;
  targetType?: TrayPinTargetType;
  targetId?: string | null;
  targetKey?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  sortIndex?: number | null;
};

function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function isTargetType(value: unknown): value is TrayPinTargetType {
  return typeof value === "string" && TARGET_TYPES.includes(value as TrayPinTargetType);
}

async function currentUserId() {
  const session = await auth();
  return (session?.user as Record<string, unknown> | undefined)?.id as string | undefined;
}

async function resolveWorkspaceForRequest(request: NextRequest, body?: TrayPinBody) {
  const { searchParams } = new URL(request.url);
  return resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: body?.workspaceId ?? searchParams.get("workspaceId"),
    explicitCompanyId: body?.companyId ?? searchParams.get("companyId"),
    requireExplicitForBearer: true,
  });
}

function scopedPinWhere(userId: string, workspaceId?: string | null, companyId?: string | null) {
  return and(
    eq(trayPins.userId, userId),
    workspaceId ? eq(trayPins.workspaceId, workspaceId) : eq(trayPins.companyId, companyId ?? "")
  );
}

async function resolveTarget(request: NextRequest, workspace: { id: string; companyId?: string | null }, body: TrayPinBody) {
  if (!isTargetType(body.targetType)) {
    return { error: NextResponse.json({ error: "targetType must be task, chat_session, or chat_thread" }, { status: 400 }) };
  }

  const rawTargetId = body.targetId?.trim() || null;
  const rawTargetKey = body.targetKey?.trim() || null;
  if (!rawTargetId && !rawTargetKey) {
    return { error: NextResponse.json({ error: "targetId or targetKey is required" }, { status: 400 }) };
  }

  if (body.targetType === "task") {
    if (!rawTargetId) return { error: NextResponse.json({ error: "targetId is required for task pins" }, { status: 400 }) };
    const [task] = await withRetry(() =>
      db!.select().from(tasks).where(eq(tasks.id, rawTargetId)).limit(1)
    );
    if (!task) return { error: NextResponse.json({ error: "Target not found" }, { status: 404 }) };
    if (task.workspaceId !== workspace.id && task.companyId !== workspace.companyId) return { error: forbiddenResponse() };
    return {
      targetType: body.targetType,
      targetId: task.id,
      targetKey: task.id,
      title: body.title?.trim() || task.title,
      metadata: { shortId: task.shortId, status: task.status, priority: task.priority, ...(body.metadata ?? {}) },
    };
  }

  if (body.targetType === "chat_session") {
    const [session] = await withRetry(() =>
      db!.select().from(chatSessions)
        .where(rawTargetId ? eq(chatSessions.id, rawTargetId) : eq(chatSessions.gatewaySessionKey, rawTargetKey!))
        .limit(1)
    );
    if (!session) return { error: NextResponse.json({ error: "Target not found" }, { status: 404 }) };
    if (!(await canAccessChatSession(request, session))) return { error: forbiddenResponse() };
    return {
      targetType: body.targetType,
      targetId: session.id,
      targetKey: session.gatewaySessionKey || session.id,
      title: body.title?.trim() || session.title || session.agentId.toUpperCase(),
      metadata: { agentId: session.agentId, gatewaySessionKey: session.gatewaySessionKey, ...(body.metadata ?? {}) },
    };
  }

  const [thread] = await withRetry(() =>
    db!.select().from(chatThreads)
      .where(rawTargetId ? eq(chatThreads.id, rawTargetId) : or(
        eq(chatThreads.threadSessionKey, rawTargetKey!),
        eq(chatThreads.parentSessionKey, rawTargetKey!)
      ))
      .limit(1)
  );
  if (!thread) return { error: NextResponse.json({ error: "Target not found" }, { status: 404 }) };
  if (!(await canAccessChatSession(request, {
    workspaceId: thread.workspaceId,
    companyId: thread.companyId,
    channelId: thread.channelId,
  }))) return { error: forbiddenResponse() };
  return {
    targetType: body.targetType,
    targetId: thread.id,
    targetKey: thread.threadSessionKey,
    title: body.title?.trim() || `Thread with ${thread.agentId.toUpperCase()}`,
    metadata: {
      agentId: thread.agentId,
      parentSessionKey: thread.parentSessionKey,
      parentMessageId: thread.parentMessageId,
      threadSessionKey: thread.threadSessionKey,
      ...(body.metadata ?? {}),
    },
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const workspace = await resolveWorkspaceForRequest(request);
  if (!workspace) return forbiddenResponse();

  const pins = await withRetry(() =>
    db!.select().from(trayPins)
      .where(scopedPinWhere(userId, workspace.id, workspace.companyId))
      .orderBy(asc(trayPins.sortIndex), asc(trayPins.createdAt))
  );

  return NextResponse.json({ pins });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const body = await request.json() as TrayPinBody;
  const workspace = await resolveWorkspaceForRequest(request, body);
  if (!workspace) return forbiddenResponse();

  const resolved = await resolveTarget(request, workspace, body);
  if ("error" in resolved) return resolved.error;

  const values = {
    companyId: workspace.companyId ?? null,
    workspaceId: workspace.id,
    userId,
    targetType: resolved.targetType,
    targetId: resolved.targetId,
    targetKey: resolved.targetKey,
    title: resolved.title,
    metadata: resolved.metadata,
    sortIndex: body.sortIndex ?? 0,
    updatedAt: new Date(),
  };

  let [pin] = await withRetry(() =>
    db!.insert(trayPins)
      .values(values)
      .onConflictDoUpdate({
        target: [trayPins.userId, trayPins.targetType, trayPins.targetKey],
        set: values,
      })
      .returning()
  );
  if (!pin) {
    [pin] = await withRetry(() =>
      db!.select().from(trayPins)
        .where(and(
          eq(trayPins.userId, userId),
          eq(trayPins.targetType, resolved.targetType),
          eq(trayPins.targetKey, resolved.targetKey)
        ))
        .limit(1)
    );
  }

  return NextResponse.json({ pin }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const body = await request.json() as TrayPinBody & { id?: string };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Partial<typeof trayPins.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title?.trim() || "";
  if (body.metadata !== undefined) updates.metadata = body.metadata;
  if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex ?? 0;

  const [pin] = await withRetry(() =>
    db!.update(trayPins)
      .set(updates)
      .where(and(eq(trayPins.id, body.id!), eq(trayPins.userId, userId)))
      .returning()
  );

  if (!pin) return NextResponse.json({ error: "Pin not found" }, { status: 404 });
  return NextResponse.json({ pin });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const deleted = await withRetry(() =>
    db!.delete(trayPins)
      .where(and(eq(trayPins.id, id), eq(trayPins.userId, userId)))
      .returning({ id: trayPins.id })
  );

  return NextResponse.json({ deleted: deleted.length });
}
