import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const [skill] = await withRetry(() =>
      db!.select().from(schema.skills).where(eq(schema.skills.id, id))
    );

    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json(skill);
  } catch (err) {
    console.error("[api/skills/[id]] GET Error:", err);
    return NextResponse.json({ error: "Failed to fetch skill" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.description !== undefined) updates.description = body.description;
    if (body.content !== undefined) updates.content = body.content;
    if (body.version !== undefined) updates.version = body.version;
    if (body.sourceRef !== undefined) updates.sourceRef = body.sourceRef;
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.installed !== undefined) updates.installed = body.installed;

    updates.updatedAt = new Date();

    const [updated] = await withRetry(() =>
      db!.update(schema.skills).set(updates).where(eq(schema.skills.id, id)).returning()
    );

    if (!updated) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/skills/[id]] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update skill" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    await withRetry(() =>
      db!.delete(schema.skills).where(eq(schema.skills.id, id))
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/skills/[id]] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to delete skill" }, { status: 500 });
  }
}
