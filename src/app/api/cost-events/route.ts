import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@/db";
import { costEvents } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { recordCost } from "@/lib/budget";

export const dynamic = "force-dynamic";

/** GET /api/cost-events?company_id=xxx&agent_id=xxx&from=date&to=date */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const conditions = [eq(costEvents.companyId, companyId)];

  const agentId = searchParams.get("agent_id");
  if (agentId) {
    conditions.push(eq(costEvents.agentId, agentId));
  }

  const from = searchParams.get("from");
  if (from) {
    conditions.push(gte(costEvents.createdAt, new Date(from)));
  }

  const to = searchParams.get("to");
  if (to) {
    conditions.push(lte(costEvents.createdAt, new Date(to)));
  }

  const result = await db
    .select()
    .from(costEvents)
    .where(and(...conditions))
    .orderBy(desc(costEvents.createdAt))
    .limit(500);

  return NextResponse.json(result);
}

/** POST /api/cost-events — log a cost event (also updates agent budget spend) */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.agentId || !body.companyId || !body.provider || !body.model || body.tokensIn === undefined || body.tokensOut === undefined || !body.costUsd) {
    return NextResponse.json(
      { error: "agentId, companyId, provider, model, tokensIn, tokensOut, and costUsd are required" },
      { status: 400 }
    );
  }

  const result = await recordCost({
    agentId: body.agentId,
    companyId: body.companyId,
    taskId: body.taskId || null,
    provider: body.provider,
    model: body.model,
    tokensIn: body.tokensIn,
    tokensOut: body.tokensOut,
    costUsd: body.costUsd,
    metadata: body.metadata || null,
  });

  if (!result) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  return NextResponse.json(result, { status: 201 });
}
