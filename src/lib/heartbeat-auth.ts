import { NextRequest, NextResponse } from "next/server";

export function validateHeartbeatAuth(req: NextRequest): NextResponse | null {
  const expectedToken = process.env.HEARTBEAT_SECRET;

  // Local dev: no secret configured = allow all heartbeats (zero-config)
  if (!expectedToken) {
    return null;
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
