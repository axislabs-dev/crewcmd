import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/blueprints — List all blueprints (built-in + company custom).
 * Query params: ?category=development&company_id=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const companyId = searchParams.get("company_id");

  interface BlueprintListItem {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: string;
    icon: string;
    agentCount: number;
    isBuiltIn: boolean;
    companyId: string | null;
    template: schema.BlueprintTemplate;
    popularity: number;
    createdAt: string | null;
    updatedAt: string | null;
  }

  // Start with built-in blueprints (always available)
  let builtIns: BlueprintListItem[] = BUILT_IN_BLUEPRINTS.map((bp) => ({
    id: `builtin-${bp.slug}`,
    ...bp,
    isBuiltIn: true,
    companyId: null,
    popularity: 0,
    createdAt: null,
    updatedAt: null,
  }));

  if (category) {
    builtIns = builtIns.filter((bp) => bp.category === category);
  }

  // Fetch custom blueprints from DB
  let customBlueprints: BlueprintListItem[] = [];
  if (db) {
    try {
      const conditions: ReturnType<typeof eq>[] = [];
      if (companyId) {
        conditions.push(
          or(
            eq(schema.teamBlueprints.companyId, companyId),
            isNull(schema.teamBlueprints.companyId)
          )!
        );
      }
      if (category) {
        conditions.push(eq(schema.teamBlueprints.category, category));
      }

      const rows = await withRetry(() =>
        conditions.length > 0
          ? db!.select().from(schema.teamBlueprints).where(and(...conditions))
          : db!.select().from(schema.teamBlueprints)
      );

      customBlueprints = rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        category: r.category,
        icon: r.icon,
        agentCount: r.agentCount,
        isBuiltIn: r.isBuiltIn,
        companyId: r.companyId,
        template: r.template,
        popularity: r.popularity,
        createdAt: r.createdAt?.toISOString() ?? null,
        updatedAt: r.updatedAt?.toISOString() ?? null,
      }));
    } catch (err) {
      console.error("[api/blueprints] Error fetching custom blueprints:", err);
    }
  }

  // Merge: DB entries override built-ins with same slug
  const dbSlugs = new Set(customBlueprints.map((b) => b.slug));
  const merged = [
    ...builtIns.filter((b) => !dbSlugs.has(b.slug)),
    ...customBlueprints,
  ];

  return NextResponse.json({ blueprints: merged });
}

/**
 * POST /api/blueprints — Create a custom blueprint (save a company's current team as a blueprint).
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { name, slug, description, category, icon, agentCount, companyId, template } = body;

    if (!name || !slug || !description || !category || !icon || !template) {
      return NextResponse.json(
        { error: "name, slug, description, category, icon, and template are required" },
        { status: 400 }
      );
    }

    const [created] = await withRetry(() =>
      db!.insert(schema.teamBlueprints).values({
        name,
        slug,
        description,
        category,
        icon,
        agentCount: agentCount ?? template.agents?.length ?? 0,
        isBuiltIn: false,
        companyId: companyId ?? null,
        template,
      }).returning()
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/blueprints] POST Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "A blueprint with that slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create blueprint" }, { status: 500 });
  }
}
