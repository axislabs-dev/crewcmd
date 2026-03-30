import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { escalationPaths } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** PATCH /api/escalation-paths/[id] — update path */
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
    .update(escalationPaths)
    .set({
      ...(body.triggerType !== undefined && { triggerType: body.triggerType }),
      ...(body.sourceAgentId !== undefined && { sourceAgentId: body.sourceAgentId }),
      ...(body.escalateToAgentId !== undefined && { escalateToAgentId: body.escalateToAgentId }),
      ...(body.escalateToUserId !== undefined && { escalateToUserId: body.escalateToUserId }),
      ...(body.timeoutMinutes !== undefined && { timeoutMinutes: body.timeoutMinutes }),
      ...(body.autoEscalate !== undefined && { autoEscalate: body.autoEscalate }),
    })
    .where(eq(escalationPaths.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Path not found" }, { status: 404 });
  }

  await logAudit(updated.companyId, body.updatedBy ?? "system", "updated", "escalation_path", id, {
    changes: body,
  });

  return NextResponse.json(updated);
}

/** DELETE /api/escalation-paths/[id] — remove path */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  const [path] = await db
    .select()
    .from(escalationPaths)
    .where(eq(escalationPaths.id, id))
    .limit(1);

  if (!path) {
    return NextResponse.json({ error: "Path not found" }, { status: 404 });
  }

  await db.delete(escalationPaths).where(eq(escalationPaths.id, id));

  await logAudit(path.companyId, "system", "deleted", "escalation_path", id, {
    triggerType: path.triggerType,
  });

  return NextResponse.json({ success: true });
}
