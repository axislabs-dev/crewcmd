import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  return NextResponse.json({ error: "Direct per-user agent sharing is disabled in v1. Use org-owned agents with team/org visibility instead." }, { status: 409 });
}
