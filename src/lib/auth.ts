import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Fallback allowlist — used if DB is unavailable
const ALLOWED_GITHUB_USERS = (process.env.ALLOWED_GITHUB_USERS ?? "digiphd")
  .split(",")
  .map((u) => u.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  pages: {
    signIn: "/",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      const username = (profile?.login as string | undefined)?.toLowerCase();
      if (!username) return "/access-denied";

      // Try DB-backed check first
      if (db) {
        try {
          // Check if users table has any rows — bootstrap first user as super_admin
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(users);
          const totalUsers = Number(countResult[0]?.count ?? 0);

          if (totalUsers === 0) {
            // First user ever → auto-promote to super_admin
            await db.insert(users).values({
              githubUsername: username,
              githubId: profile?.id?.toString(),
              email: profile?.email as string | undefined,
              role: "super_admin",
              invitedBy: "system",
              acceptedAt: new Date(),
            });
            return true;
          }

          // Look up existing user
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.githubUsername, username))
            .limit(1);

          if (!user) return "/access-denied";

          // If pending invite, mark as accepted
          if (!user.acceptedAt) {
            await db
              .update(users)
              .set({
                acceptedAt: new Date(),
                githubId: profile?.id?.toString(),
                email: profile?.email as string | undefined,
              })
              .where(eq(users.id, user.id));
          }

          return true;
        } catch {
          // DB unavailable — fall through to env var allowlist
        }
      }

      // Fallback: env var allowlist
      if (!ALLOWED_GITHUB_USERS.includes(username)) {
        return "/access-denied";
      }
      return true;
    },

    async jwt({ token, profile }) {
      if (profile) {
        const username = (profile.login as string)?.toLowerCase();
        token.username = username;
        token.githubId = profile.id?.toString();

        // Fetch role from DB
        if (db && username) {
          try {
            const [user] = await db
              .select({ role: users.role })
              .from(users)
              .where(eq(users.githubUsername, username))
              .limit(1);
            token.role = user?.role ?? "viewer";
          } catch {
            token.role = "viewer";
          }
        } else {
          // Fallback: first allowed user is super_admin
          token.role = ALLOWED_GITHUB_USERS[0] === username ? "super_admin" : "viewer";
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = session.user as any;
        user.role = token.role;
        user.username = token.username;
      }
      return session;
    },

    authorized({ auth, request }) {
      // API routes handle their own auth (bearer tokens, agent keys) — let them through
      const isApi = request.nextUrl.pathname.startsWith("/api/");
      if (isApi) return true;
      return !!auth;
    },
  },
});
