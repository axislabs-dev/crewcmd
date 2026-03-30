import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orgChartNodes } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { getOrgTree } from "@/lib/delegation";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/org-chart?company_id=xxx — returns full org tree (nested structure) */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const tree = await getOrgTree(companyId);
  return NextResponse.json(tree);
}

/** POST /api/org-chart — create or update an org chart node */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.agentId || !body.positionTitle) {
    return NextResponse.json(
      { error: "companyId, agentId, and positionTitle are required" },
      { status: 400 }
    );
  }

  if (body.id) {
    // Update existing node
    const [updated] = await db
      .update(orgChartNodes)
      .set({
        agentId: body.agentId,
        parentNodeId: body.parentNodeId ?? null,
        positionTitle: body.positionTitle,
        canDelegate: body.canDelegate ?? true,
        sortIndex: body.sortIndex ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(orgChartNodes.id, body.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    await logAudit(body.companyId, body.changedBy ?? "system", "updated", "org_chart_node", updated.id, {
      agentId: body.agentId,
      positionTitle: body.positionTitle,
      parentNodeId: body.parentNodeId,
    });

    return NextResponse.json(updated);
  }

  // Create new node
  const [node] = await db
    .insert(orgChartNodes)
    .values({
      companyId: body.companyId,
      agentId: body.agentId,
      parentNodeId: body.parentNodeId ?? null,
      positionTitle: body.positionTitle,
      canDelegate: body.canDelegate ?? true,
      sortIndex: body.sortIndex ?? 0,
    })
    .returning();

  await logAudit(body.companyId, body.changedBy ?? "system", "created", "org_chart_node", node.id, {
    agentId: body.agentId,
    positionTitle: body.positionTitle,
  });

  return NextResponse.json(node, { status: 201 });
}
