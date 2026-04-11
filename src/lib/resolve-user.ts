import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

/**
 * Resolve the current authenticated user from the session.
 * Tries by user id first (credentials auth), then by email, then by githubUsername (legacy).
 * Also handles system/API auth via HEARTBEAT_SECRET - returns a system user.
 */
export async function resolveCurrentUser(request?: Request | NextRequest) {
  if (!db) return null;

  // Handle system/API auth via HEARTBEAT_SECRET
  const authHeader = request?.headers?.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const expectedToken = process.env.HEARTBEAT_SECRET?.trim();
    if (token === expectedToken) {
      // Return a system user for API auth
      return {
        id: "00000000-0000-0000-0000-000000000001",
        email: "system@axislabs.dev",
        name: "System",
        role: "super_admin" as const,
        githubUsername: null,
        githubId: null,
        passwordHash: null,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  const session = await auth();
  if (!session?.user) return null;

  const u = session.user as Record<string, unknown>;
  const userId = u.id as string | undefined;
  const email = u.email as string | undefined;
  const username = u.username as string | undefined;

  if (userId) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user) return user;
  }

  if (email) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user) return user;
  }

  if (username) {
    const [user] = await db.select().from(users).where(eq(users.githubUsername, username)).limit(1);
    if (user) return user;
  }

  return null;
}
