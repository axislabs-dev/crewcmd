import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, inviteTokens } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { name, email, password, inviteToken } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    // Check if this is the first user
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);
    const totalUsers = Number(countResult[0]?.count ?? 0);

    if (totalUsers > 0 && !inviteToken) {
      // Not first user and no invite token — reject
      return NextResponse.json(
        { error: "Registration is invite-only. Contact your admin." },
        { status: 403 }
      );
    }

    // If invite token provided, validate it
    if (inviteToken) {
      const [invite] = await db
        .select()
        .from(inviteTokens)
        .where(eq(inviteTokens.token, inviteToken))
        .limit(1);

      if (!invite) {
        return NextResponse.json(
          { error: "Invalid invite token" },
          { status: 400 }
        );
      }

      if (invite.acceptedAt) {
        return NextResponse.json(
          { error: "This invite has already been used" },
          { status: 400 }
        );
      }

      if (invite.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "This invite has expired" },
          { status: 400 }
        );
      }

      // If invite has a specific email, verify it matches
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json(
          { error: "This invite is for a different email address" },
          { status: 403 }
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const isFirstUser = totalUsers === 0;

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        role: isFirstUser ? "super_admin" : "viewer",
        invitedBy: isFirstUser ? "system" : "invite",
        acceptedAt: new Date(),
      })
      .returning({ id: users.id });

    return NextResponse.json({
      id: newUser.id,
      role: isFirstUser ? "super_admin" : "viewer",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
