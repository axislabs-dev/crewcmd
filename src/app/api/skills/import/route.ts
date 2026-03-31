import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { source, query, companyId, name, slug, description, version, sourceUrl, content } = body;

    if (!source || !companyId) {
      return NextResponse.json({ error: "source and companyId are required" }, { status: 400 });
    }

    const skillName = name || query || "Imported Skill";
    const skillSlug = slug || skillName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const [created] = await withRetry(() =>
      db!.insert(schema.skills).values({
        name: skillName,
        slug: skillSlug,
        description: description || null,
        source,
        sourceUrl: sourceUrl || null,
        version: version || null,
        content: content || null,
        companyId,
        metadata: {},
        installed: true,
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/skills/import] POST Error:", err);
    return NextResponse.json({ error: "Failed to import skill" }, { status: 500 });
  }
}
