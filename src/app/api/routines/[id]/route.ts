import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routineTemplates } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { calculateNextExecution } from "@/lib/heartbeat-engine";
import { executeRoutine } from "@/lib/routines";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** PATCH /api/routines/[id] — update routine */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  // If schedule changed, recalculate next_create_at
  let nextCreateAt: Date | undefined;
  if (body.schedule) {
    nextCreateAt = calculateNextExecution(body.schedule);
  }

  const [updated] = await db
    .update(routineTemplates)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.taskTemplate !== undefined && { taskTemplate: body.taskTemplate }),
      ...(body.schedule !== undefined && { schedule: body.schedule }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(nextCreateAt && { nextCreateAt }),
      updatedAt: new Date(),
    })
    .where(eq(routineTemplates.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 });
  }

  await logAudit(updated.companyId, body.updatedBy ?? "system", "updated", "routine_template", id, {
    changes: body,
  });

  return NextResponse.json(updated);
}

/** DELETE /api/routines/[id] — remove routine */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const [routine] = await db
    .select()
    .from(routineTemplates)
    .where(eq(routineTemplates.id, id))
    .limit(1);

  if (!routine) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 });
  }

  await db.delete(routineTemplates).where(eq(routineTemplates.id, id));

  await logAudit(routine.companyId, "system", "deleted", "routine_template", id, {
    title: routine.title,
  });

  return NextResponse.json({ success: true });
}

/** POST /api/routines/[id] — manually trigger routine (create task now) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const task = await executeRoutine(id);

  if (!task) {
    return NextResponse.json({ error: "Routine not found or disabled" }, { status: 404 });
  }

  return NextResponse.json(task, { status: 201 });
}
