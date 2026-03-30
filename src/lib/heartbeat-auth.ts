import { NextRequest, NextResponse } from "next/server";

export function validateHeartbeatAuth(req: NextRequest): NextResponse | null {
  const expectedToken = process.env.HEARTBEAT_SECRET;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
