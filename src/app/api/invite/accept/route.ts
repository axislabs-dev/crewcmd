import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { inviteTokens, companyMembers } from "@/db/schema";

export const dynamic = "force-dynamic";

/** POST /api/invite/accept — accept an invite token and join the company */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized — please sign in first" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { token } = await request.json();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const [invite] = await db
    .select()
    .from(inviteTokens)
    .where(eq(inviteTokens.token, token))
    .limit(1);

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }

  if (invite.acceptedAt) {
    return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 400 });
  }

  const userId = (session.user as Record<string, unknown>).id as string;

  // Check if already a member
  const [existing] = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, invite.companyId),
        eq(companyMembers.userId, userId)
      )
    )
    .limit(1);

  if (existing) {
    // Already a member — mark invite as accepted and return success
    await db
      .update(inviteTokens)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(inviteTokens.id, invite.id));

    return NextResponse.json({ ok: true, companyId: invite.companyId, role: invite.role });
  }

  // Add user to company
  await db.insert(companyMembers).values({
    companyId: invite.companyId,
    userId,
    role: invite.role,
    invitedBy: invite.createdBy || "system",
  });

  // Mark invite as accepted
  await db
    .update(inviteTokens)
    .set({ acceptedAt: new Date(), acceptedBy: userId })
    .where(eq(inviteTokens.id, invite.id));

  return NextResponse.json({ ok: true, companyId: invite.companyId, role: invite.role });
}
