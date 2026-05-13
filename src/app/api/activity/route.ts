import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { requireCompanyAuditReadAccess } from "@/lib/company-audit-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id") ?? searchParams.get("companyId");
  const agentId = searchParams.get("agentId");
  const actionType = searchParams.get("actionType");
  const limit = searchParams.get("limit");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const accessError = await requireCompanyAuditReadAccess(request, companyId);
  if (accessError) return accessError;

  try {
    const conditions = [eq(schema.activityLog.companyId, companyId)];

    if (agentId) {
      conditions.push(eq(schema.activityLog.agentId, agentId));
    }
    if (actionType) {
      conditions.push(eq(schema.activityLog.actionType, actionType));
    }

    let queryLimit = 100;
    if (limit) {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) {
        queryLimit = Math.min(n, 500);
      }
    }

    const result = await withRetry(() =>
      db!
        .select()
        .from(schema.activityLog)
        .where(and(...conditions))
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(queryLimit)
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

    const [activity] = await db.insert(schema.activityLog).values({
      agentId: body.agentId,
      actionType: body.actionType,
      description: body.description,
      metadata: body.metadata || null,
    }).returning();

    return NextResponse.json(activity, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
