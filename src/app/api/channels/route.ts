import { NextRequest } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { channelMembers, channels, users } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { resolveAccessibleWorkspace, type WorkspaceRecord } from "@/lib/workspace";
import { canAccessChatSession } from "@/lib/chat-session-access";

const ADMIN_CHANNEL_ROLES = new Set(["owner", "admin"]);

type ChannelRecord = typeof channels.$inferSelect;

const DEFAULT_CHANNEL_NAME = "crew";
const DEFAULT_CHANNEL_DESCRIPTION = "Default channel for crew-wide conversation.";

const LEGACY_DEFAULT_CHANNEL_NAME = "general";
const LEGACY_DEFAULT_CHANNEL_DESCRIPTION = "Default channel for workspace-wide conversation.";

function forbiddenResponse() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

function slugifyChannelName(name: string) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `channel-${Date.now()}`;
}

async function allocateScopedChannelSlug(workspace: WorkspaceRecord, name: string) {
  const baseSlug = slugifyChannelName(name);
  const existingRows = await withRetry(() =>
    db!.select({ slug: channels.slug })
      .from(channels)
      .where(scopeWhere(workspace))
      .limit(500)
  );
  const existing = new Set(existingRows.map((row) => row.slug).filter(Boolean));
  if (!existing.has(baseSlug)) return baseSlug;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${baseSlug.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${baseSlug.slice(0, 48)}-${Date.now().toString(36)}`;
}

function scopeWhere(workspace: WorkspaceRecord) {
  return workspace.companyId
    ? eq(channels.companyId, workspace.companyId)
    : eq(channels.workspaceId, workspace.id);
}

async function resolveChannelScope(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return resolveAccessibleWorkspace({
    request,
    explicitCompanyId: searchParams.get("companyId"),
    explicitWorkspaceId: searchParams.get("workspaceId"),
    requireExplicitForBearer: true,
  });
}

async function normalizeDefaultChannelNames(rows: ChannelRecord[]) {
  const hasCrew = rows.some((channel) => channel.name === DEFAULT_CHANNEL_NAME || channel.slug === DEFAULT_CHANNEL_NAME);
  if (hasCrew) return rows;

  const legacyDefault = rows.find((channel) =>
    (channel.name === LEGACY_DEFAULT_CHANNEL_NAME || channel.slug === LEGACY_DEFAULT_CHANNEL_NAME) &&
    channel.description === LEGACY_DEFAULT_CHANNEL_DESCRIPTION
  );
  if (!legacyDefault) return rows;

  try {
    const [updated] = await withRetry(() =>
      db!.update(channels)
        .set({
          name: DEFAULT_CHANNEL_NAME,
          slug: DEFAULT_CHANNEL_NAME,
          description: DEFAULT_CHANNEL_DESCRIPTION,
        })
        .where(eq(channels.id, legacyDefault.id))
        .returning()
    );
    if (!updated) return rows;
    return rows.map((channel) => channel.id === updated.id ? updated : channel);
  } catch {
    return rows;
  }
}

async function createDefaultChannel(workspace: WorkspaceRecord, userId: string) {
  const [created] = await withRetry(() =>
    db!.insert(channels).values({
      companyId: workspace.companyId,
      workspaceId: workspace.companyId ? null : workspace.id,
      name: DEFAULT_CHANNEL_NAME,
      slug: DEFAULT_CHANNEL_NAME,
      description: DEFAULT_CHANNEL_DESCRIPTION,
      visibility: "restricted",
      createdByUserId: userId,
    }).returning()
  );

  await withRetry(() =>
    db!.insert(channelMembers).values({
      channelId: created.id,
      memberType: "user",
      userId,
      role: "owner",
      joinedByUserId: userId,
    }).returning({ id: channelMembers.id })
  );

  return created;
}

async function loadMembers(channelIds: string[]) {
  if (channelIds.length === 0) return new Map<string, Array<Record<string, unknown>>>();
  const rows = await withRetry(() =>
    db!.select({
      id: channelMembers.id,
      channelId: channelMembers.channelId,
      memberType: channelMembers.memberType,
      userId: channelMembers.userId,
      agentId: channelMembers.agentId,
      role: channelMembers.role,
      agentParticipationMode: channelMembers.agentParticipationMode,
      name: users.name,
      email: users.email,
    })
      .from(channelMembers)
      .leftJoin(users, eq(channelMembers.userId, users.id))
      .where(inArray(channelMembers.channelId, channelIds))
  );

  const byChannel = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const list = byChannel.get(row.channelId) ?? [];
    list.push({
      id: row.id,
      memberType: row.memberType,
      userId: row.userId,
      agentId: row.agentId,
      role: row.role,
      agentParticipationMode: row.agentParticipationMode,
      name: row.name,
      email: row.email,
    });
    byChannel.set(row.channelId, list);
  }
  return byChannel;
}

function roleForUser(members: Array<Record<string, unknown>>, userId: string | null | undefined) {
  if (!userId) return null;
  const membership = members.find((member) => member.memberType === "user" && member.userId === userId);
  return typeof membership?.role === "string" ? membership.role : null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return Response.json({ error: "Database not initialized" }, { status: 500 });

  const workspace = await resolveChannelScope(request);
  if (!workspace) return forbiddenResponse();

  const user = await resolveCurrentUser(request);
  let rows = await withRetry(() =>
    db!.select()
      .from(channels)
      .where(and(scopeWhere(workspace), isNull(channels.archivedAt)))
      .orderBy(desc(channels.updatedAt))
      .limit(100)
  );
  if (rows.length === 0 && user?.id) {
    try {
      const defaultChannel = await createDefaultChannel(workspace, user.id);
      rows = [defaultChannel];
    } catch {
      rows = await withRetry(() =>
        db!.select()
          .from(channels)
          .where(and(scopeWhere(workspace), isNull(channels.archivedAt)))
          .orderBy(desc(channels.updatedAt))
          .limit(100)
      );
    }
  }

  rows = await normalizeDefaultChannelNames(rows);

  const readable = [] as ChannelRecord[];
  for (const channel of rows) {
    if (await canAccessChatSession(request, { companyId: channel.companyId, workspaceId: channel.workspaceId, channelId: channel.id })) readable.push(channel);
  }
  const membersByChannel = await loadMembers(readable.map((channel) => channel.id));
  const responseChannels = readable.map((channel) => {
    const members = membersByChannel.get(channel.id) ?? [];
    const myRole = roleForUser(members, user?.id);
    return {
      ...channel,
      members,
      myRole,
      canManage: Boolean(myRole && ADMIN_CHANNEL_ROLES.has(myRole)),
    };
  });

  return Response.json({ channels: responseChannels });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return Response.json({ error: "Database not initialized" }, { status: 500 });

  const body = await request.json() as {
    companyId?: string | null;
    workspaceId?: string | null;
    type?: "channel" | "dm" | "project_room" | "voice_room";
    name?: string;
    purpose?: string | null;
    description?: string | null;
    visibility?: "private" | "restricted" | "team" | "org";
  };
  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitCompanyId: body.companyId ?? null,
    explicitWorkspaceId: body.workspaceId ?? null,
    requireExplicitForBearer: true,
  });
  if (!workspace) return forbiddenResponse();

  const user = await resolveCurrentUser(request);
  if (!user?.id) return forbiddenResponse();

  const name = body.name?.trim();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const slug = await allocateScopedChannelSlug(workspace, name);

  const [created] = await withRetry(() =>
    db!.insert(channels).values({
      companyId: workspace.companyId,
      workspaceId: workspace.companyId ? null : workspace.id,
      type: body.type ?? "channel",
      name,
      slug,
      description: (body.purpose ?? body.description ?? null) || null,
      visibility: body.visibility ?? "restricted",
      createdByUserId: user.id,
    }).returning()
  );

  await withRetry(() =>
    db!.insert(channelMembers).values({
      channelId: created.id,
      memberType: "user",
      userId: user.id,
      role: "owner",
      joinedByUserId: user.id,
    }).returning({ id: channelMembers.id })
  );

  return Response.json({ channel: { ...created, members: [{ memberType: "user", userId: user.id, role: "owner" }], myRole: "owner", canManage: true } }, { status: 201 });
}
