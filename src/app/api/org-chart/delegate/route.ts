import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { delegateTask } from "@/lib/delegation";

export const dynamic = "force-dynamic";

/** POST /api/org-chart/delegate — manager delegates task to a report */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const body = await request.json();

  if (!body.taskId || !body.fromAgentId || !body.toAgentId || !body.companyId) {
    return NextResponse.json(
      { error: "taskId, fromAgentId, toAgentId, and companyId are required" },
      { status: 400 }
    );
  }

  const result = await delegateTask(
    body.taskId,
    body.fromAgentId,
    body.toAgentId,
    body.companyId
  );

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}
