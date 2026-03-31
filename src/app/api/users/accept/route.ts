import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  try {
    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const [invite] = await db
      .select()
      .from(users)
      .where(eq(users.inviteToken, token))
      .limit(1);

    if (!invite) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }

    if (invite.acceptedAt) {
      return NextResponse.json({ error: "Invite already accepted" }, { status: 400 });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 400 });
    }

    // Verify the logged-in user matches the invite (by email or username)
    const currentEmail = session.user.email;
    const currentUsername = (session.user as Record<string, unknown>).username as string | undefined;
    const matchesEmail = currentEmail && invite.email === currentEmail;
    const matchesUsername = currentUsername && invite.githubUsername === currentUsername;
    if (!matchesEmail && !matchesUsername) {
      return NextResponse.json(
        { error: "This invite is for a different user" },
        { status: 403 }
      );
    }

    await db
      .update(users)
      .set({
        acceptedAt: new Date(),
        email: currentEmail || invite.email,
      })
      .where(eq(users.id, invite.id));

    return NextResponse.json({ ok: true, role: invite.role });
  } catch (error) {
    console.error("[api/users/accept] Error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
