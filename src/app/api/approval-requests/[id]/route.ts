import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { processApproval } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** PATCH /api/approval-requests/[id] — approve or reject */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  if (body.approved === undefined || !body.decidedBy) {
    return NextResponse.json(
      { error: "approved (boolean) and decidedBy are required" },
      { status: 400 }
    );
  }

  const result = await processApproval(
    id,
    body.decidedBy,
    body.approved,
    body.reason
  );

  if (!result) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
