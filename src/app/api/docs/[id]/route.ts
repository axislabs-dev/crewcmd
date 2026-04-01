import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const { id } = await params;
  const [doc] = await db
    .select()
    .from(schema.docs)
    .where(eq(schema.docs.id, id));

  if (!doc) {
    return NextResponse.json({ error: "Doc not found" }, { status: 404 });
  }

  return NextResponse.json(doc);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updates.title = body.title;
    if (body.content !== undefined) updates.content = body.content;
    if (body.category !== undefined) updates.category = body.category;
    if (body.docType !== undefined) updates.docType = body.docType;
    if (body.visibility !== undefined) updates.visibility = body.visibility;
    if (body.authorAgentId !== undefined)
      updates.authorAgentId = body.authorAgentId;
    if (body.authorUserId !== undefined)
      updates.authorUserId = body.authorUserId;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.taskId !== undefined) updates.taskId = body.taskId;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.pinned !== undefined) updates.pinned = body.pinned;

    const [doc] = await db
      .update(schema.docs)
      .set(updates)
      .where(eq(schema.docs.id, id))
      .returning();

    if (!doc) {
      return NextResponse.json({ error: "Doc not found" }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const { id } = await params;
  const [doc] = await db
    .delete(schema.docs)
    .where(eq(schema.docs.id, id))
    .returning();

  if (!doc) {
    return NextResponse.json({ error: "Doc not found" }, { status: 404 });
  }

  return NextResponse.json(doc);
}
