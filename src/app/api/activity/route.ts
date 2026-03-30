import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const actionType = searchParams.get("actionType");
  const limit = searchParams.get("limit");

  try {
    let result = await withRetry(() => db!.select().from(schema.activityLog));

    if (agentId) {
      result = result.filter((a) => a.agentId === agentId);
    }
    if (actionType) {
      result = result.filter((a) => a.actionType === actionType);
    }

    result.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (limit) {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) {
        result = result.slice(0, n);
      }
    }

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
