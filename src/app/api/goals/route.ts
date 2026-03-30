import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/goals?company_id=xxx — list goals for a company */
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
    .from(goals)
    .where(eq(goals.companyId, companyId));

  return NextResponse.json(result);
}

/** POST /api/goals — create a new goal */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.title || !body.companyId) {
    return NextResponse.json(
      { error: "title and companyId are required" },
      { status: 400 }
    );
  }

  const [goal] = await db.insert(goals).values({
    companyId: body.companyId,
    parentGoalId: body.parentGoalId || null,
    title: body.title,
    description: body.description || null,
    status: body.status || "active",
    ownerAgentId: body.ownerAgentId || null,
    sortIndex: body.sortIndex ?? 0,
  }).returning();

  return NextResponse.json(goal, { status: 201 });
}
