import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, withRetry } from "@/db";
import { savedItems } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type SavedItemStatus = "in_progress" | "archived" | "completed";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function currentUserId() {
  const session = await auth();
  return (session?.user as Record<string, unknown> | undefined)?.id as string | undefined;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as {
    status?: SavedItemStatus;
    note?: string | null;
    reminderAt?: string | null;
  };

  const [item] = await withRetry(() =>
    db!.update(savedItems)
      .set({
        ...(body.status ? { status: body.status } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.reminderAt !== undefined ? { reminderAt: body.reminderAt ? new Date(body.reminderAt) : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId)))
      .returning()
  );

  if (!item) return NextResponse.json({ error: "Saved item not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not initialized" }, { status: 500 });

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "User session required" }, { status: 401 });

  const { id } = await params;
  const deleted = await withRetry(() =>
    db!.delete(savedItems)
      .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId)))
      .returning({ id: savedItems.id })
  );

  return NextResponse.json({ deleted: deleted.length });
}
