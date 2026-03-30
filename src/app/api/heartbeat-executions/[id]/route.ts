import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { heartbeatExecutions } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/heartbeat-executions/[id] — single execution detail */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const [execution] = await db
    .select()
    .from(heartbeatExecutions)
    .where(eq(heartbeatExecutions.id, id))
    .limit(1);

  if (!execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 });
  }

  return NextResponse.json(execution);
}
