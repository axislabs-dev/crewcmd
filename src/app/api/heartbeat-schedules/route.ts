import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { heartbeatSchedules } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { calculateNextExecution } from "@/lib/heartbeat-engine";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/heartbeat-schedules?company_id=xxx — list schedules */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const schedules = await db
    .select()
    .from(heartbeatSchedules)
    .where(eq(heartbeatSchedules.companyId, companyId));

  return NextResponse.json(schedules);
}

/** POST /api/heartbeat-schedules — create schedule */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.agentId || !body.schedule) {
    return NextResponse.json(
      { error: "companyId, agentId, and schedule are required" },
      { status: 400 }
    );
  }

  const nextExecution = calculateNextExecution(body.schedule, body.timezone ?? "UTC");

  const [schedule] = await db
    .insert(heartbeatSchedules)
    .values({
      companyId: body.companyId,
      agentId: body.agentId,
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      timezone: body.timezone ?? "UTC",
      nextExecutionAt: nextExecution,
      maxDurationMinutes: body.maxDurationMinutes ?? 30,
    })
    .returning();

  await logAudit(body.companyId, body.createdBy ?? "system", "created", "heartbeat_schedule", schedule.id, {
    agentId: body.agentId,
    schedule: body.schedule,
  });

  return NextResponse.json(schedule, { status: 201 });
}
