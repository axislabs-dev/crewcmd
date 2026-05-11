import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasHeartbeatSecret, matchesHeartbeatBearerToken } from "@/lib/heartbeat-secret";

/**
 * Require authentication for API mutation endpoints.
 * Accepts either a Bearer HEARTBEAT_SECRET token or a valid NextAuth session.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  // 1. Check Bearer token
  const hasConfiguredSecret = await hasHeartbeatSecret();
  if (hasConfiguredSecret && await matchesHeartbeatBearerToken(req.headers.get("authorization"))) {
    return null; // authorized
  }

  // 2. Check NextAuth session
  const session = await auth();
  if (session?.user) {
    return null; // authorized
  }

  return NextResponse.json(
    { error: "Unauthorized", debug: { hasBearerToken: hasConfiguredSecret } },
    { status: 401 }
  );
}
