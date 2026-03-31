import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

/**
 * Resolve the current authenticated user from the session.
 * Tries by user id first (credentials auth), then by email, then by githubUsername (legacy).
 */
export async function resolveCurrentUser() {
  if (!db) return null;

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
