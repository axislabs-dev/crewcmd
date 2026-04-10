import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: "Direct per-user agent sharing is disabled in v1. Use org-owned agents with team/org visibility instead." }, { status: 409 });
}
