import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/audit-log?company_id=xxx&actor=xxx&action=xxx&from=date&to=date — query audit log */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const actor = searchParams.get("actor");
  const action = searchParams.get("action");
  const entityType = searchParams.get("entity_type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const conditions = [eq(auditLog.companyId, companyId)];

  if (actor) conditions.push(eq(auditLog.actor, actor));
  if (action) conditions.push(eq(auditLog.action, action));
  if (entityType) conditions.push(eq(auditLog.entityType, entityType));
  if (from) conditions.push(gte(auditLog.createdAt, new Date(from)));
  if (to) conditions.push(lte(auditLog.createdAt, new Date(to)));

  const entries = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);

  return NextResponse.json(entries);
}
