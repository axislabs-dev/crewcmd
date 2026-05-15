import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasHeartbeatSecret, matchesHeartbeatBearerToken } from "@/lib/heartbeat-secret";

/**
 * Require authentication for API mutation endpoints.
 * Accepts a valid NextAuth session.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const session = await auth();
  if (session?.user) {
    return null; // authorized
  }

  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401 }
  );
}

/**
 * Require runtime bearer authentication for endpoints intentionally called by
 * OpenClaw runtimes.
 */
export async function requireRuntimeBearerAuth(req: NextRequest): Promise<NextResponse | null> {
  const hasConfiguredSecret = await hasHeartbeatSecret();
  if (hasConfiguredSecret && await matchesHeartbeatBearerToken(req.headers.get("authorization"))) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Require either a user session or explicit runtime bearer authentication.
 * Prefer requireAuth for user/session endpoints and requireRuntimeBearerAuth
 * for runtime-only endpoints.
 */
export async function requireUserOrRuntimeAuth(req: NextRequest): Promise<NextResponse | null> {
  const sessionError = await requireAuth(req);
  if (!sessionError) return null;

  return requireRuntimeBearerAuth(req);
}
