import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { heartbeatSchedules } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { calculateNextExecution } from "@/lib/heartbeat-engine";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** PATCH /api/heartbeat-schedules/[id] — update schedule */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  // If schedule expression changed, recalculate next execution
  let nextExecutionAt: Date | undefined;
  if (body.schedule) {
    nextExecutionAt = calculateNextExecution(body.schedule, body.timezone ?? "UTC");
  }

  const [updated] = await db
    .update(heartbeatSchedules)
    .set({
      ...(body.schedule !== undefined && { schedule: body.schedule }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.maxDurationMinutes !== undefined && { maxDurationMinutes: body.maxDurationMinutes }),
      ...(nextExecutionAt && { nextExecutionAt }),
      updatedAt: new Date(),
    })
    .where(eq(heartbeatSchedules.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  await logAudit(updated.companyId, body.updatedBy ?? "system", "updated", "heartbeat_schedule", id, {
    changes: body,
  });

  return NextResponse.json(updated);
}

/** DELETE /api/heartbeat-schedules/[id] — remove schedule */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const [schedule] = await db
    .select()
    .from(heartbeatSchedules)
    .where(eq(heartbeatSchedules.id, id))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  await db.delete(heartbeatSchedules).where(eq(heartbeatSchedules.id, id));

  await logAudit(schedule.companyId, "system", "deleted", "heartbeat_schedule", id, {
    agentId: schedule.agentId,
  });

  return NextResponse.json({ success: true });
}
