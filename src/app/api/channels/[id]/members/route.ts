import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { channelMembers, channels, users } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { canAccessChatSession } from "@/lib/chat-session-access";

function forbiddenResponse() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveUserIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;

  if (UUID_RE.test(normalized)) {
    const [user] = await withRetry(() =>
      db!.select({ id: users.id, name: users.name, email: users.email, githubUsername: users.githubUsername })
        .from(users)
        .where(eq(users.id, normalized))
        .limit(1)
    );
    if (user) return user;
  }

  if (normalized.includes("@")) {
    const [user] = await withRetry(() =>
      db!.select({ id: users.id, name: users.name, email: users.email, githubUsername: users.githubUsername })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1)
    );
    if (user) return user;
  }

  const [user] = await withRetry(() =>
    db!.select({ id: users.id, name: users.name, email: users.email, githubUsername: users.githubUsername })
      .from(users)
      .where(eq(users.githubUsername, normalized))
      .limit(1)
  );
  return user ?? null;
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
    userId?: string;
    identifier?: string;
    email?: string;
    githubUsername?: string;
    role?: "admin" | "member" | "contributor" | "viewer" | "guest";
  };
  const identifier = body.userId ?? body.identifier ?? body.email ?? body.githubUsername;
  if (!identifier) return Response.json({ error: "user identifier required" }, { status: 400 });

  const targetUser = await resolveUserIdentifier(identifier);
  if (!targetUser) return Response.json({ error: "User not found" }, { status: 404 });

  const role = body.role ?? "member";
  const [member] = await withRetry(() => db!.insert(channelMembers).values({
    channelId: id,
    memberType: "user",
    userId: targetUser.id,
    role,
    joinedByUserId: user?.id ?? null,
  }).onConflictDoUpdate({
    target: [channelMembers.channelId, channelMembers.userId],
    set: { role, updatedAt: new Date() },
  }).returning());

  return Response.json({
    member: {
      ...member,
      name: targetUser.name,
      email: targetUser.email,
      githubUsername: targetUser.githubUsername,
    },
  }, { status: 201 });
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
