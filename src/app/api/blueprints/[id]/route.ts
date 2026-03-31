import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/blueprints/[id] — Get a single blueprint by ID or built-in slug.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check if it's a built-in reference (builtin-slug format)
  if (id.startsWith("builtin-")) {
    const slug = id.replace("builtin-", "");
    const bp = BUILT_IN_BLUEPRINTS.find((b) => b.slug === slug);
    if (!bp) {
      return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: `builtin-${bp.slug}`,
      ...bp,
      isBuiltIn: true,
      companyId: null,
      popularity: 0,
      createdAt: null,
      updatedAt: null,
    });
  }

  // Look up in DB
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const [row] = await withRetry(() =>
      db!.select().from(schema.teamBlueprints).where(eq(schema.teamBlueprints.id, id))
    );

    if (!row) {
      return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    console.error("[api/blueprints/[id]] Error:", err);
    return NextResponse.json({ error: "Failed to fetch blueprint" }, { status: 500 });
  }
}
