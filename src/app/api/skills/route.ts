import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { BUILT_IN_SKILLS } from "@/lib/skills/built-in";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  // Built-in skills are always returned, regardless of DB state
  const builtIns = BUILT_IN_SKILLS.map((s) => ({
    id: `built-in:${s.slug}`,
    companyId,
    name: s.name,
    slug: s.slug,
    description: s.description,
    source: "built-in" as const,
    sourceUrl: null,
    sourceRef: null,
    version: null,
    content: null,
    metadata: {
      category: s.category,
      runtime: s.runtime,
      command: s.command ?? null,
      icon: s.icon,
      compatibleProviders: s.compatibleProviders ?? null,
    },
    installed: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  if (!db) {
    return NextResponse.json(builtIns);
  }

  try {
    const rows = await withRetry(() =>
      db!.select().from(schema.skills).where(eq(schema.skills.companyId, companyId))
    );

    return NextResponse.json([...builtIns, ...rows]);
  } catch (err) {
    console.error("[api/skills] GET Error:", err);
    return NextResponse.json(builtIns);
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
