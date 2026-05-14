import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { channelMembers, channels } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { canAccessChatSession } from "@/lib/chat-session-access";

function forbiddenResponse() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

async function loadChannel(id: string) {
  const [channel] = await withRetry(() => db!.select().from(channels).where(eq(channels.id, id)).limit(1));
  return channel ?? null;
}

async function canManageChannel(request: NextRequest, channelId: string) {
  const user = await resolveCurrentUser(request);
  if (!user?.id) return false;
  const [membership] = await withRetry(() =>
    db!.select({ role: channelMembers.role })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.memberType, "user"),
        eq(channelMembers.userId, user.id),
      ))
      .limit(1)
  );
  return membership?.role === "owner" || membership?.role === "admin";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return Response.json({ error: "Database not initialized" }, { status: 500 });
  const { id } = await context.params;
  const channel = await loadChannel(id);
  if (!channel) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessChatSession(request, { companyId: channel.companyId, workspaceId: channel.workspaceId, channelId: channel.id }))) return forbiddenResponse();
  if (!(await canManageChannel(request, id))) return forbiddenResponse();

  const user = await resolveCurrentUser(request);
  const body = await request.json() as {
    memberType?: "user" | "agent";
    userId?: string;
    agentId?: string;
    role?: "admin" | "member" | "contributor" | "viewer" | "guest";
    agentParticipationMode?: "silent" | "watching" | "mention_only" | "proactive" | "on_call";
  };
  const memberType = body.memberType ?? (body.agentId ? "agent" : "user");
  if (memberType === "agent") {
    if (!body.agentId) return Response.json({ error: "agentId required" }, { status: 400 });
    const [existing] = await withRetry(() =>
      db!.select({ id: channelMembers.id })
        .from(channelMembers)
        .where(and(
          eq(channelMembers.channelId, id),
          eq(channelMembers.memberType, "agent"),
          eq(channelMembers.agentId, body.agentId!),
        ))
        .limit(1)
    );
    const [member] = existing
      ? await withRetry(() => db!.update(channelMembers)
        .set({
          role: body.role ?? "member",
          agentParticipationMode: body.agentParticipationMode ?? "mention_only",
          updatedAt: new Date(),
        })
        .where(eq(channelMembers.id, existing.id))
        .returning())
      : await withRetry(() => db!.insert(channelMembers).values({
        channelId: id,
        memberType: "agent",
        agentId: body.agentId,
        role: body.role ?? "member",
        agentParticipationMode: body.agentParticipationMode ?? "mention_only",
        joinedByUserId: user?.id ?? null,
      }).returning());

    return Response.json({ member }, { status: 201 });
  }

  if (!body.userId) return Response.json({ error: "userId required" }, { status: 400 });

  const [existing] = await withRetry(() =>
    db!.select({ id: channelMembers.id })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, id),
        eq(channelMembers.memberType, "user"),
        eq(channelMembers.userId, body.userId!),
      ))
      .limit(1)
  );
  const [member] = existing
    ? await withRetry(() => db!.update(channelMembers)
      .set({ role: body.role ?? "member", updatedAt: new Date() })
      .where(eq(channelMembers.id, existing.id))
      .returning())
    : await withRetry(() => db!.insert(channelMembers).values({
      channelId: id,
      memberType: "user",
      userId: body.userId,
      role: body.role ?? "member",
      joinedByUserId: user?.id ?? null,
    }).returning());

  return Response.json({ member }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return Response.json({ error: "Database not initialized" }, { status: 500 });
  const { id } = await context.params;
  const channel = await loadChannel(id);
  if (!channel) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessChatSession(request, { companyId: channel.companyId, workspaceId: channel.workspaceId, channelId: channel.id }))) return forbiddenResponse();
  if (!(await canManageChannel(request, id))) return forbiddenResponse();

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const removed = await withRetry(() => db!.delete(channelMembers).where(and(
    eq(channelMembers.channelId, id),
    eq(channelMembers.memberType, "user"),
    eq(channelMembers.userId, userId),
  )).returning({ id: channelMembers.id }));

  return Response.json({ removed: removed.length });
}
