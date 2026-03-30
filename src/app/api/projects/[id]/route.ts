import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  if (!db) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { id } = await params;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, id));

  return NextResponse.json({ ...project, tasks });
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.color !== undefined) updates.color = body.color;
    if (body.status !== undefined) updates.status = body.status;
    if (body.ownerAgentId !== undefined) updates.ownerAgentId = body.ownerAgentId;
    if (body.documents !== undefined) updates.documents = body.documents;
    if (body.context !== undefined) {
      updates.context = body.context;
      updates.contextUpdatedAt = new Date();
      if (body.contextUpdatedBy !== undefined) {
        updates.contextUpdatedBy = body.contextUpdatedBy;
      }
    }

    const [project] = await db.update(schema.projects).set(updates).where(eq(schema.projects.id, id)).returning();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const [project] = await db.delete(schema.projects).where(eq(schema.projects.id, id)).returning();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}
