import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routineTemplates } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { calculateNextExecution } from "@/lib/heartbeat-engine";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/routines?company_id=xxx — list routines */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const routines = await db
    .select()
    .from(routineTemplates)
    .where(eq(routineTemplates.companyId, companyId));

  return NextResponse.json(routines);
}

/** POST /api/routines — create routine */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.title || !body.schedule || !body.taskTemplate) {
    return NextResponse.json(
      { error: "companyId, title, schedule, and taskTemplate are required" },
      { status: 400 }
    );
  }

  const nextCreate = calculateNextExecution(body.schedule);

  const [routine] = await db
    .insert(routineTemplates)
    .values({
      companyId: body.companyId,
      title: body.title,
      description: body.description ?? null,
      taskTemplate: body.taskTemplate,
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      nextCreateAt: nextCreate,
    })
    .returning();

  await logAudit(body.companyId, body.createdBy ?? "system", "created", "routine_template", routine.id, {
    title: body.title,
    schedule: body.schedule,
  });

  return NextResponse.json(routine, { status: 201 });
}
