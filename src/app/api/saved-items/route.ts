import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, withRetry } from "@/db";
import { chatMessages, chatSessions, savedItems } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type SavedItemSourceType = "chat_message" | "task" | "approval" | "doc" | "run";
type SavedItemStatus = "in_progress" | "archived" | "completed";

function previewTitle(content: string) {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text || "Saved message";
}

async function currentUserId() {
  const session = await auth();
  return (session?.user as Record<string, unknown> | undefined)?.id as string | undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const workspaceId = searchParams.get("workspaceId");
  const sourceType = searchParams.get("sourceType") as SavedItemSourceType | null;
  const status = searchParams.get("status") as SavedItemStatus | null;
  const sourceIds = searchParams.get("sourceIds")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];

  const conditions = [eq(savedItems.userId, userId)];
  if (companyId) conditions.push(eq(savedItems.companyId, companyId));
  if (workspaceId) conditions.push(eq(savedItems.workspaceId, workspaceId));
  if (sourceType) conditions.push(eq(savedItems.sourceType, sourceType));
  if (status) conditions.push(eq(savedItems.status, status));
  if (sourceIds.length > 0) conditions.push(inArray(savedItems.sourceId, sourceIds));

  const rows = await withRetry(() =>
    db!.select().from(savedItems)
      .where(and(...conditions))
      .orderBy(desc(savedItems.updatedAt), desc(savedItems.createdAt))
      .limit(200)
  );

  const chatMessageIds = rows
    .filter((item) => item.sourceType === "chat_message")
    .map((item) => item.sourceId);
  const messageRows = chatMessageIds.length > 0
    ? await withRetry(() =>
        db!.select({
          id: chatMessages.id,
          role: chatMessages.role,
          content: chatMessages.content,
          createdAt: chatMessages.createdAt,
          metadata: chatMessages.metadata,
          agentId: chatSessions.agentId,
          gatewaySessionKey: chatSessions.gatewaySessionKey,
        })
          .from(chatMessages)
          .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
          .where(inArray(chatMessages.id, chatMessageIds))
      )
    : [];
  const messagesById = new Map(messageRows.map((message) => [message.id, message]));

  return NextResponse.json({
    items: rows.map((item) => ({
      ...item,
      source: item.sourceType === "chat_message" ? messagesById.get(item.sourceId) ?? null : null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const body = await request.json() as {
    companyId?: string | null;
    workspaceId?: string | null;
    sourceType?: SavedItemSourceType;
    sourceId?: string;
    status?: SavedItemStatus;
    title?: string | null;
    note?: string | null;
    reminderAt?: string | null;
    metadata?: Record<string, unknown> | null;
  };

  if (!body.sourceType || !body.sourceId) {
    return NextResponse.json({ error: "sourceType and sourceId are required" }, { status: 400 });
  }

  let title = body.title ?? null;
  let metadata = body.metadata ?? null;
  if (body.sourceType === "chat_message") {
    const [message] = await withRetry(() =>
      db!.select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        metadata: chatMessages.metadata,
        companyId: chatSessions.companyId,
        workspaceId: chatSessions.workspaceId,
        agentId: chatSessions.agentId,
        gatewaySessionKey: chatSessions.gatewaySessionKey,
      })
        .from(chatMessages)
        .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
        .where(eq(chatMessages.id, body.sourceId!))
        .limit(1)
    );
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (body.companyId && message.companyId !== body.companyId) {
      return NextResponse.json({ error: "Message not found in company scope" }, { status: 404 });
    }
    if (body.workspaceId && message.workspaceId !== body.workspaceId) {
      return NextResponse.json({ error: "Message not found in workspace scope" }, { status: 404 });
    }
    title = title ?? previewTitle(message.content);
    metadata = {
      ...(metadata ?? {}),
      preview: previewTitle(message.content),
      role: message.role,
      agentId: message.agentId,
      gatewaySessionKey: message.gatewaySessionKey,
      messageCreatedAt: message.createdAt?.toISOString?.() ?? message.createdAt,
    };
  }

  const now = new Date();
  const [item] = await withRetry(() =>
    db!.insert(savedItems)
      .values({
        userId,
        companyId: body.companyId ?? null,
        workspaceId: body.workspaceId ?? null,
        sourceType: body.sourceType!,
        sourceId: body.sourceId!,
        status: body.status ?? "in_progress",
        title,
        note: body.note ?? null,
        reminderAt: body.reminderAt ? new Date(body.reminderAt) : null,
        metadata,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [savedItems.userId, savedItems.sourceType, savedItems.sourceId],
        set: {
          status: body.status ?? "in_progress",
          title,
          note: body.note ?? null,
          reminderAt: body.reminderAt ? new Date(body.reminderAt) : null,
          metadata,
          updatedAt: now,
        },
      })
      .returning()
  );

  return NextResponse.json({ item }, { status: 201 });
}
