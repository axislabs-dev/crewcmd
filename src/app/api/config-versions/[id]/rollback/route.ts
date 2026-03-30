import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { rollbackConfig } from "@/lib/governance";

export const dynamic = "force-dynamic";

/** POST /api/config-versions/[id]/rollback — rollback to a specific version */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  if (!body.rolledBackBy) {
    return NextResponse.json(
      { error: "rolledBackBy is required" },
      { status: 400 }
    );
  }

  const result = await rollbackConfig(id, body.rolledBackBy);

  if (!result) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
