import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as Record<string, unknown>).role as string;
  if (role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { email, githubUsername, role: inviteRole } = body;

    const identifier = email || githubUsername;
    if (!identifier || !inviteRole) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const validRoles = ["admin", "viewer"];
    if (!validRoles.includes(inviteRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check if user already exists
    const [existing] = email
      ? await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
      : await db.select().from(users).where(eq(users.githubUsername, githubUsername.toLowerCase())).limit(1);

    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const inviteToken = randomUUID();
    const inviterName = session.user.name || session.user.email || "system";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(users).values({
      email: (email || `${githubUsername}@pending.local`).toLowerCase(),
      githubUsername: githubUsername?.toLowerCase() || null,
      role: inviteRole,
      invitedBy: inviterName,
      inviteToken,
      expiresAt,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteLink = `${baseUrl}/invite/${inviteToken}`;

    return NextResponse.json({ ok: true, inviteLink, inviteToken });
  } catch (error) {
    console.error("[api/users/invite] Error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
