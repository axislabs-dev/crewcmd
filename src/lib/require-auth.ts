import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHeartbeatSecret } from "@/lib/heartbeat-secret";

/**
 * Require authentication for API mutation endpoints.
 * Accepts either a Bearer HEARTBEAT_SECRET token or a valid NextAuth session.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  // 1. Check Bearer token
  const expectedToken = await getHeartbeatSecret();
  if (expectedToken) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const providedToken = authHeader.slice(7);
      if (providedToken === expectedToken.trim()) {
        return null; // authorized
      }
    }
  }

  // 2. Check NextAuth session
  const session = await auth();
  if (session?.user) {
    return null; // authorized
  }

  return NextResponse.json(
    { error: "Unauthorized", debug: { hasBearerToken: !!expectedToken } },
    { status: 401 }
  );
}
