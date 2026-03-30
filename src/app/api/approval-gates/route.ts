import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalGates } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/approval-gates?company_id=xxx — list gates for a company */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const gates = await db
    .select()
    .from(approvalGates)
    .where(eq(approvalGates.companyId, companyId));

  return NextResponse.json(gates);
}

/** POST /api/approval-gates — create a gate */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.gateType) {
    return NextResponse.json(
      { error: "companyId and gateType are required" },
      { status: 400 }
    );
  }

  const [gate] = await db
    .insert(approvalGates)
    .values({
      companyId: body.companyId,
      gateType: body.gateType,
      requiresHuman: body.requiresHuman ?? true,
      approverAgentId: body.approverAgentId ?? null,
      approverUserId: body.approverUserId ?? null,
    })
    .returning();

  await logAudit(body.companyId, body.createdBy ?? "system", "created", "approval_gate", gate.id, {
    gateType: body.gateType,
    requiresHuman: gate.requiresHuman,
  });

  return NextResponse.json(gate, { status: 201 });
}
