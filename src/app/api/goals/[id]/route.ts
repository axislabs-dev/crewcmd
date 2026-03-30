import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/goals/[id] */
export async function GET(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, id))
    .limit(1);

  if (!goal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(goal);
}

/** PATCH /api/goals/[id] */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status !== undefined) updates.status = body.status;
  if (body.parentGoalId !== undefined) updates.parentGoalId = body.parentGoalId;
  if (body.ownerAgentId !== undefined) updates.ownerAgentId = body.ownerAgentId;
  if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex;

  const [updated] = await db
    .update(goals)
    .set(updates)
    .where(eq(goals.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

/** DELETE /api/goals/[id] */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const [deleted] = await db
    .delete(goals)
    .where(eq(goals.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
