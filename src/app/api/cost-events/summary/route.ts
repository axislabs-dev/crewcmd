import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { costEvents, tasks } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/cost-events/summary?company_id=xxx&group_by=agent|project|model&from=date&to=date */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const groupBy = searchParams.get("group_by") || "agent";

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const conditions = [eq(costEvents.companyId, companyId)];

  const from = searchParams.get("from");
  if (from) {
    conditions.push(gte(costEvents.createdAt, new Date(from)));
  }

  const to = searchParams.get("to");
  if (to) {
    conditions.push(lte(costEvents.createdAt, new Date(to)));
  }

  const whereClause = and(...conditions);

  if (groupBy === "model") {
    const result = await db
      .select({
        groupKey: costEvents.model,
        totalCost: sql<string>`sum(${costEvents.costUsd})`,
        totalTokensIn: sql<number>`sum(${costEvents.tokensIn})`,
        totalTokensOut: sql<number>`sum(${costEvents.tokensOut})`,
        eventCount: sql<number>`count(*)`,
      })
      .from(costEvents)
      .where(whereClause)
      .groupBy(costEvents.model);

    return NextResponse.json(result);
  }

  if (groupBy === "project") {
    const result = await db
      .select({
        groupKey: tasks.projectId,
        totalCost: sql<string>`sum(${costEvents.costUsd})`,
        totalTokensIn: sql<number>`sum(${costEvents.tokensIn})`,
        totalTokensOut: sql<number>`sum(${costEvents.tokensOut})`,
        eventCount: sql<number>`count(*)`,
      })
      .from(costEvents)
      .leftJoin(tasks, eq(costEvents.taskId, tasks.id))
      .where(whereClause)
      .groupBy(tasks.projectId);

    return NextResponse.json(result);
  }

  // Default: group by agent
  const result = await db
    .select({
      groupKey: costEvents.agentId,
      totalCost: sql<string>`sum(${costEvents.costUsd})`,
      totalTokensIn: sql<number>`sum(${costEvents.tokensIn})`,
      totalTokensOut: sql<number>`sum(${costEvents.tokensOut})`,
      eventCount: sql<number>`count(*)`,
    })
    .from(costEvents)
    .where(whereClause)
    .groupBy(costEvents.agentId);

  return NextResponse.json(result);
}
