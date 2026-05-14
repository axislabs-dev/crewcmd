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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return Response.json({ error: "Database not initialized" }, { status: 500 });

  const { id } = await context.params;
  const channel = await loadChannel(id);
  if (!channel) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessChatSession(request, { companyId: channel.companyId, workspaceId: channel.workspaceId, channelId: channel.id }))) return forbiddenResponse();
  if (!(await canManageChannel(request, id))) return forbiddenResponse();

  const body = await request.json() as { name?: string; purpose?: string | null; description?: string | null };
  const updates: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.purpose === "string" || typeof body.description === "string") {
    updates.description = (body.purpose ?? body.description ?? "").trim() || null;
  }

  const [updated] = await withRetry(() => db!.update(channels).set(updates).where(eq(channels.id, id)).returning());
  return Response.json({ channel: updated });
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

  const [updated] = await withRetry(() =>
    db!.update(channels).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(channels.id, id)).returning()
  );
  return Response.json({ channel: updated });
}
