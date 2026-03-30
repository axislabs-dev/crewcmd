import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { agentBudgets } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ agentId: string }> };

/** GET /api/budgets/[agentId]?company_id=xxx */
export async function GET(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { agentId } = await params;
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const [budget] = await db
    .select()
    .from(agentBudgets)
    .where(
      and(
        eq(agentBudgets.agentId, agentId),
        eq(agentBudgets.companyId, companyId)
      )
    )
    .limit(1);

  if (!budget) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(budget);
}

/** PATCH /api/budgets/[agentId] — update budget fields */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { agentId } = await params;
  const body = await request.json();

  if (!body.companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.monthlyLimit !== undefined) updates.monthlyLimit = body.monthlyLimit;
  if (body.alertThreshold !== undefined) updates.alertThreshold = body.alertThreshold;
  if (body.autoPause !== undefined) updates.autoPause = body.autoPause;
  if (body.periodStart !== undefined) updates.periodStart = body.periodStart;

  const [updated] = await db
    .update(agentBudgets)
    .set(updates)
    .where(
      and(
        eq(agentBudgets.agentId, agentId),
        eq(agentBudgets.companyId, body.companyId)
      )
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

/** DELETE /api/budgets/[agentId]?company_id=xxx */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { agentId } = await params;
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(agentBudgets)
    .where(
      and(
        eq(agentBudgets.agentId, agentId),
        eq(agentBudgets.companyId, companyId)
      )
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
