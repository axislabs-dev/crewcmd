import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { escalationPaths } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { logAudit } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/escalation-paths?company_id=xxx — list escalation paths */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const paths = await db
    .select()
    .from(escalationPaths)
    .where(eq(escalationPaths.companyId, companyId));

  return NextResponse.json(paths);
}

/** POST /api/escalation-paths — create escalation path */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.triggerType) {
    return NextResponse.json(
      { error: "companyId and triggerType are required" },
      { status: 400 }
    );
  }

  const [path] = await db
    .insert(escalationPaths)
    .values({
      companyId: body.companyId,
      triggerType: body.triggerType,
      sourceAgentId: body.sourceAgentId ?? null,
      escalateToAgentId: body.escalateToAgentId ?? null,
      escalateToUserId: body.escalateToUserId ?? null,
      timeoutMinutes: body.timeoutMinutes ?? 60,
      autoEscalate: body.autoEscalate ?? true,
    })
    .returning();

  await logAudit(body.companyId, body.createdBy ?? "system", "created", "escalation_path", path.id, {
    triggerType: body.triggerType,
  });

  return NextResponse.json(path, { status: 201 });
}
