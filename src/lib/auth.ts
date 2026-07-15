import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { trustConfiguredAuthHost } from "@/lib/auth-host";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: trustConfiguredAuthHost(),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;
        if (!db) return null;

        try {
          const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

          if (!user || !user.passwordHash) return null;

          const valid = await bcrypt.compare(password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            name: user.name ?? user.email,
            email: user.email,
            role: user.role,
            image: user.avatarUrl,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = ((user as Record<string, unknown>).role as string | undefined) ?? "viewer";
        token.email = user.email;
        token.name = user.name;
        token.picture = (user as Record<string, unknown>).image as string | undefined;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        const u = session.user as unknown as Record<string, unknown>;
        u.id = token.id;
        u.role = token.role;
        u.email = token.email;
        u.name = token.name;
        u.image = typeof token.picture === "string" ? token.picture : null;
      }
      return session;
    },

    authorized({ auth: session, request }) {
      const isApi = request.nextUrl.pathname.startsWith("/api/");
      if (isApi) return true;
      return !!session;
    },
  },
});
