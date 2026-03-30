import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalGates } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** PATCH /api/approval-gates/[id] — update gate config */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  const [updated] = await db
    .update(approvalGates)
    .set({
      ...(body.gateType !== undefined && { gateType: body.gateType }),
      ...(body.requiresHuman !== undefined && { requiresHuman: body.requiresHuman }),
      ...(body.approverAgentId !== undefined && { approverAgentId: body.approverAgentId }),
      ...(body.approverUserId !== undefined && { approverUserId: body.approverUserId }),
    })
    .where(eq(approvalGates.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }

  await logAudit(updated.companyId, body.updatedBy ?? "system", "updated", "approval_gate", id, {
    changes: body,
  });

  return NextResponse.json(updated);
}

/** DELETE /api/approval-gates/[id] — remove a gate */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const [gate] = await db
    .select()
    .from(approvalGates)
    .where(eq(approvalGates.id, id))
    .limit(1);

  if (!gate) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }

  await db.delete(approvalGates).where(eq(approvalGates.id, id));

  await logAudit(gate.companyId, "system", "deleted", "approval_gate", id, {
    gateType: gate.gateType,
  });

  return NextResponse.json({ success: true });
}
