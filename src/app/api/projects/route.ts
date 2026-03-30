import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import type { ProjectStatus } from "@/lib/data";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as ProjectStatus | null;
  const ownerId = searchParams.get("ownerId");

  try {
    let result = await withRetry(() => db!.select().from(schema.projects));

    if (status) {
      result = result.filter((p) => p.status === status);
    }
    if (ownerId) {
      result = result.filter((p) => p.ownerAgentId === ownerId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/projects] Database error:", error);
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

    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const [project] = await db.insert(schema.projects).values({
      name: body.name,
      description: body.description || null,
      color: body.color || "#00f0ff",
      status: body.status || "active",
      ownerAgentId: body.ownerAgentId || null,
      documents: body.documents || null,
    }).returning();

    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
