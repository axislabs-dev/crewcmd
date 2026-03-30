import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { agentBudgets } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/budgets?company_id=xxx — list budgets for a company */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const result = await db
    .select()
    .from(agentBudgets)
    .where(eq(agentBudgets.companyId, companyId));

  return NextResponse.json(result);
}

/** POST /api/budgets — create or update an agent budget */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.agentId || !body.companyId || !body.monthlyLimit) {
    return NextResponse.json(
      { error: "agentId, companyId, and monthlyLimit are required" },
      { status: 400 }
    );
  }

  // Check if budget already exists for this agent+company
  const [existing] = await db
    .select()
    .from(agentBudgets)
    .where(
      and(
        eq(agentBudgets.agentId, body.agentId),
        eq(agentBudgets.companyId, body.companyId)
      )
    )
    .limit(1);

  if (existing) {
    // Update existing budget
    const [updated] = await db
      .update(agentBudgets)
      .set({
        monthlyLimit: body.monthlyLimit,
        alertThreshold: body.alertThreshold ?? existing.alertThreshold,
        autoPause: body.autoPause ?? existing.autoPause,
        updatedAt: new Date(),
      })
      .where(eq(agentBudgets.id, existing.id))
      .returning();

    return NextResponse.json(updated);
  }

  // Create new budget
  const [budget] = await db
    .insert(agentBudgets)
    .values({
      agentId: body.agentId,
      companyId: body.companyId,
      monthlyLimit: body.monthlyLimit,
      currentSpend: body.currentSpend || "0",
      periodStart: body.periodStart || new Date(),
      alertThreshold: body.alertThreshold ?? 80,
      autoPause: body.autoPause ?? true,
    })
    .returning();

  return NextResponse.json(budget, { status: 201 });
}
