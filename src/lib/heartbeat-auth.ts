import { NextRequest, NextResponse } from "next/server";
import { hasHeartbeatSecret, matchesHeartbeatBearerToken } from "@/lib/heartbeat-secret";

export async function validateHeartbeatAuth(req: NextRequest): Promise<NextResponse | null> {
  const expected = await matchesHeartbeatBearerToken(req.headers.get("authorization"));
  const hasConfiguredSecret = await hasHeartbeatSecret();
  if (!hasConfiguredSecret) {
    return null;
  }

  if (!expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
