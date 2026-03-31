import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, withRetry } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as Record<string, unknown>).role as string;
  if (role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!db) return NextResponse.json([]);

  try {
    const result = await withRetry(() => db!.select().from(users));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/users] Database error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    // Prevent self-removal
    const currentUserId = (session.user as Record<string, unknown>).id as string | undefined;
    const currentEmail = session.user.email;
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (target.id === currentUserId || target.email === currentEmail) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    await db.delete(users).where(eq(users.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/users] Delete error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
