import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { heartbeatExecutions, heartbeatSchedules } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { startExecution } from "@/lib/heartbeat-engine";

export const dynamic = "force-dynamic";

/** GET /api/heartbeat-executions?company_id=xxx&agent_id=xxx&status=xxx — list executions */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const agentId = searchParams.get("agent_id");
  const status = searchParams.get("status");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const conditions = [eq(heartbeatExecutions.companyId, companyId)];
  if (agentId) conditions.push(eq(heartbeatExecutions.agentId, agentId));
  if (status) {
    const validStatuses = ["running", "completed", "failed", "timed_out", "cancelled"] as const;
    type ExecutionStatus = (typeof validStatuses)[number];
    if (validStatuses.includes(status as ExecutionStatus)) {
      conditions.push(eq(heartbeatExecutions.status, status as ExecutionStatus));
    }
  }

  const executions = await db
    .select()
    .from(heartbeatExecutions)
    .where(and(...conditions))
    .orderBy(desc(heartbeatExecutions.startedAt))
    .limit(100);

  return NextResponse.json(executions);
}

/** POST /api/heartbeat-executions — manually trigger a heartbeat execution */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.scheduleId) {
    return NextResponse.json({ error: "scheduleId is required" }, { status: 400 });
  }

  // Look up the schedule
  const [schedule] = await db
    .select()
    .from(heartbeatSchedules)
    .where(eq(heartbeatSchedules.id, body.scheduleId))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const execution = await startExecution(schedule.id, schedule.agentId, schedule.companyId);

  return NextResponse.json(execution, { status: 201 });
}
