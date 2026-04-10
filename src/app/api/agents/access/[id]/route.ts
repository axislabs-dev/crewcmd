import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function DELETE() {
  return NextResponse.json({ error: "Direct per-user agent sharing is disabled in v1." }, { status: 409 });
}
