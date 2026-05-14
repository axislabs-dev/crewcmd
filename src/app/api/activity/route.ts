import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { getCompanyIdForWorkspace, resolveAccessibleWorkspace } from "@/lib/workspace";
import { and, desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const actionType = searchParams.get("actionType");
  const limit = searchParams.get("limit");
  const workspaceId = searchParams.get("workspaceId");
  const companyId = searchParams.get("companyId") ?? searchParams.get("company_id");

  try {
    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId,
      explicitCompanyId: companyId,
      requireExplicitForBearer: true,
    });
    if (!workspace) {
      return NextResponse.json({ error: "workspaceId or companyId is required" }, { status: 400 });
    }

    const conditions = [eq(schema.activityLog.workspaceId, workspace.id)];
    if (agentId) conditions.push(eq(schema.activityLog.agentId, agentId));
    if (actionType) conditions.push(eq(schema.activityLog.actionType, actionType));

    const n = Math.min(Math.max(parseInt(limit || "100", 10) || 100, 1), 500);
    const result = await withRetry(() =>
      db!
        .select()
        .from(schema.activityLog)
        .where(and(...conditions))
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(n)
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/activity] Database error:", error);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.agentId || !body.actionType || !body.description) {
      return NextResponse.json(
        { error: "agentId, actionType, and description are required" },
        { status: 400 }
      );
    }

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: body.workspaceId ?? null,
      explicitCompanyId: body.companyId ?? null,
      requireExplicitForBearer: true,
    });
    if (!workspace) {
      return NextResponse.json({ error: "workspaceId or companyId is required" }, { status: 400 });
    }
    const companyId = workspace.companyId ?? await getCompanyIdForWorkspace(workspace.id);

    const [activity] = await db.insert(schema.activityLog).values({
      agentId: body.agentId,
      actionType: body.actionType,
      description: body.description,
      metadata: body.metadata || null,
      workspaceId: workspace.id,
      companyId,
    }).returning();

    return NextResponse.json(activity, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
