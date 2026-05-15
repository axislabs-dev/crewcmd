import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, inviteTokens } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const SIGNUP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_RATE_LIMIT_MAX = 10;

type SignupAttempt = {
  count: number;
  resetAt: number;
};

declare global {
  var crewCmdSignupAttempts: Map<string, SignupAttempt> | undefined;
}

function getSignupAttempts() {
  globalThis.crewCmdSignupAttempts ??= new Map();
  return globalThis.crewCmdSignupAttempts;
}

function getRateLimitKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor
    || request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function checkSignupRateLimit(request: Request) {
  const now = Date.now();
  const attempts = getSignupAttempts();
  const key = getRateLimitKey(request);
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + SIGNUP_RATE_LIMIT_WINDOW_MS });
    return null;
  }

  if (current.count >= SIGNUP_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  current.count += 1;
  return null;
}

export function resetSignupRateLimitForTests() {
  getSignupAttempts().clear();
}

async function ensurePgliteReady() {
  if (process.env.DATABASE_URL) return;
  const { migrationPromise } = await import("@/db/pglite");
  await migrationPromise;
}

export async function POST(request: Request) {
  try {
    const rateLimitError = checkSignupRateLimit(request);
    if (rateLimitError) return rateLimitError;

    await ensurePgliteReady();
    const { name, email, password, inviteToken } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    // Check if this is the first user
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);
    const totalUsers = Number(countResult[0]?.count ?? 0);

    if (totalUsers > 0 && !inviteToken) {
      // Not first user and no invite token — reject
      return NextResponse.json(
        { error: "Registration is invite-only. Contact your admin." },
        { status: 403 }
      );
    }

    // If invite token provided, validate it
    if (inviteToken) {
      const [invite] = await db
        .select()
        .from(inviteTokens)
        .where(eq(inviteTokens.token, inviteToken))
        .limit(1);

      if (!invite) {
        return NextResponse.json(
          { error: "Invalid invite token" },
          { status: 400 }
        );
      }

      if (invite.acceptedAt) {
        return NextResponse.json(
          { error: "This invite has already been used" },
          { status: 400 }
        );
      }

      if (invite.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "This invite has expired" },
          { status: 400 }
        );
      }

      // If invite has a specific email, verify it matches
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json(
          { error: "This invite is for a different email address" },
          { status: 403 }
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const isFirstUser = totalUsers === 0;

    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          name,
          email,
          passwordHash,
          role: isFirstUser ? "super_admin" : "viewer",
          invitedBy: isFirstUser ? "system" : "invite",
          acceptedAt: new Date(),
        })
        .returning({ id: users.id });

      // Atomically mark the invite as accepted so the token cannot be reused
      if (inviteToken) {
        const [updated] = await tx
          .update(inviteTokens)
          .set({
            acceptedAt: new Date(),
            acceptedBy: newUser.id,
          })
          .where(
            and(
              eq(inviteTokens.token, inviteToken),
              sql`${inviteTokens.acceptedAt} IS NULL`
            )
          )
          .returning({ id: inviteTokens.id });

        if (!updated) {
          throw new Error("Invite token was already used");
        }
      }

      return newUser;
    });

    return NextResponse.json({
      id: result.id,
      role: isFirstUser ? "super_admin" : "viewer",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
