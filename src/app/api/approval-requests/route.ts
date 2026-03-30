import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { requestApproval } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** GET /api/approval-requests?company_id=xxx&status=pending — list requests */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const status = searchParams.get("status");

  if (!companyId) {
    return NextResponse.json({ error: "company_id query param required" }, { status: 400 });
  }

  const conditions = [eq(approvalRequests.companyId, companyId)];

  if (status) {
    const validStatuses = ["pending", "approved", "rejected", "expired"] as const;
    if (validStatuses.includes(status as typeof validStatuses[number])) {
      conditions.push(
        eq(approvalRequests.status, status as typeof validStatuses[number])
      );
    }
  }

  const requests = await db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.createdAt));

  return NextResponse.json(requests);
}

/** POST /api/approval-requests — create a request (auto-matches to gate) */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await request.json();

  if (!body.companyId || !body.gateType || !body.requestedBy || !body.payload) {
    return NextResponse.json(
      { error: "companyId, gateType, requestedBy, and payload are required" },
      { status: 400 }
    );
  }

  const result = await requestApproval(
    body.companyId,
    body.gateType,
    body.requestedBy,
    body.payload
  );

  if (!result) {
    return NextResponse.json(
      { error: "No approval gate configured for this type" },
      { status: 404 }
    );
  }

  return NextResponse.json(result, { status: 201 });
}
