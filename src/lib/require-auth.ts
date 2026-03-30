import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Require authentication for API mutation endpoints.
 * Accepts either a Bearer HEARTBEAT_SECRET token or a valid NextAuth session.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  // 1. Check Bearer token
  const expectedToken = process.env.HEARTBEAT_SECRET;
  if (expectedToken) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${expectedToken}`) {
      return null; // authorized
    }
  }

  // 2. Check NextAuth session
  const session = await auth();
  if (session?.user) {
    return null; // authorized
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
