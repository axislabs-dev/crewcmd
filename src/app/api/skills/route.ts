import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const companyId = request.nextUrl.searchParams.get("company_id");
    if (!companyId) {
      return NextResponse.json({ error: "company_id is required" }, { status: 400 });
    }

    const rows = await withRetry(() =>
      db!.select().from(schema.skills).where(eq(schema.skills.companyId, companyId))
    );

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/skills] GET Error:", err);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { name, slug, description, source, sourceUrl, sourceRef, version, content, companyId, metadata } = body;

    if (!name || !slug || !companyId) {
      return NextResponse.json({ error: "name, slug, and companyId are required" }, { status: 400 });
    }

    const [created] = await withRetry(() =>
      db!.insert(schema.skills).values({
        name,
        slug,
        description: description || null,
        source: source || "custom",
        sourceUrl: sourceUrl || null,
        sourceRef: sourceRef || null,
        version: version || null,
        content: content || null,
        companyId,
        metadata: metadata || {},
        installed: true,
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/skills] POST Error:", err);
    return NextResponse.json({ error: "Failed to create skill" }, { status: 500 });
  }
}
