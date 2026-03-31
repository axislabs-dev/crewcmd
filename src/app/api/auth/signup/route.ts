import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

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

    if (totalUsers > 0) {
      // Not first user — reject (invite-only for subsequent users)
      return NextResponse.json(
        { error: "Registration is invite-only. Contact your admin." },
        { status: 403 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        role: "super_admin",
        invitedBy: "system",
        acceptedAt: new Date(),
      })
      .returning({ id: users.id });

    return NextResponse.json({ id: newUser.id, role: "super_admin" });
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
