import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { channelMembers, chatSessions } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

type ChatSessionScope = Pick<
  typeof chatSessions.$inferSelect,
  "workspaceId" | "companyId" | "channelId"
>;

export async function canAccessChatSession(
  request: NextRequest,
  session: ChatSessionScope,
) {
  const workspaceAllowed = session.workspaceId
    ? Boolean(await resolveAccessibleWorkspace({
        request,
        explicitWorkspaceId: session.workspaceId,
        requireExplicitForBearer: true,
      }))
    : session.companyId
      ? Boolean(await resolveAccessibleWorkspace({
          request,
          explicitCompanyId: session.companyId,
          requireExplicitForBearer: true,
        }))
      : false;

  if (!workspaceAllowed) return false;
  if (!session.channelId) return true;

  if (!db) return false;
  const user = await resolveCurrentUser(request);
  if (!user?.id) return false;

  const [membership] = await withRetry(() =>
    db!.select({ id: channelMembers.id })
      .from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, session.channelId!),
        eq(channelMembers.memberType, "user"),
        eq(channelMembers.userId, user.id),
      ))
      .limit(1)
  );

  return Boolean(membership);
}
