import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { configVersions } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/config-versions?entity_type=xxx&entity_id=xxx — version history */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entity_type");
  const entityId = searchParams.get("entity_id");
  const companyId = searchParams.get("company_id");

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "entity_type and entity_id query params required" },
      { status: 400 }
    );
  }

  const conditions = [
    eq(configVersions.entityType, entityType),
    eq(configVersions.entityId, entityId),
  ];

  if (companyId) {
    conditions.push(eq(configVersions.companyId, companyId));
  }

  const versions = await db
    .select()
    .from(configVersions)
    .where(and(...conditions))
    .orderBy(desc(configVersions.version));

  return NextResponse.json(versions);
}
