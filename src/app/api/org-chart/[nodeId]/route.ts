import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orgChartNodes } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** DELETE /api/org-chart/[nodeId] — remove a node from the org chart */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { nodeId } = await params;

  // Get the node first to know company for audit
  const [node] = await db
    .select()
    .from(orgChartNodes)
    .where(eq(orgChartNodes.id, nodeId))
    .limit(1);

  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  // Re-parent children to the deleted node's parent
  await db
    .update(orgChartNodes)
    .set({ parentNodeId: node.parentNodeId, updatedAt: new Date() })
    .where(eq(orgChartNodes.parentNodeId, nodeId));

  await db.delete(orgChartNodes).where(eq(orgChartNodes.id, nodeId));

  await logAudit(node.companyId, "system", "deleted", "org_chart_node", nodeId, {
    agentId: node.agentId,
    positionTitle: node.positionTitle,
  });

  return NextResponse.json({ success: true });
}
