import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings, companyMembers } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

/** Check if the current user is owner or admin of their active company */
async function isOwnerOrAdmin(req: NextRequest): Promise<boolean> {
  if (!db) return false;

  const user = await resolveCurrentUser();
  if (!user) return false;

  const companyId = req.headers.get("x-company-id") ?? req.nextUrl.searchParams.get("companyId");
  if (!companyId) return false;

  const [membership] = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.userId, user.id),
        eq(companyMembers.companyId, companyId)
      )
    )
    .limit(1);

  return membership?.role === "owner" || membership?.role === "admin";
}

/** Keys that any authenticated user can read (non-sensitive) */
const PUBLIC_KEYS = new Set(["chat.stopWords"]);

/** GET /api/system-settings — return a setting by key (or heartbeat_secret for legacy) */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const key = request.nextUrl.searchParams.get("key");

  // Generic key lookup
  if (key) {
    // Non-public keys require owner/admin
    if (!PUBLIC_KEYS.has(key) && !(await isOwnerOrAdmin(request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [row] = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    return NextResponse.json({ key, value: row?.value ?? null });
  }

  // Legacy: return heartbeat_secret (owner/admin only)
  if (!(await isOwnerOrAdmin(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, "heartbeat_secret"))
    .limit(1);

  return NextResponse.json({ token: row?.value ?? null });
}

/** POST /api/system-settings — regenerate heartbeat_secret (owner/admin only) */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  if (!(await isOwnerOrAdmin(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  if (body.action !== "regenerate") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const newToken = crypto.randomBytes(32).toString("hex");

  await db
    .insert(systemSettings)
    .values({ key: "heartbeat_secret", value: newToken })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: newToken, updatedAt: new Date() },
    });

  process.env.HEARTBEAT_SECRET = newToken;

  return NextResponse.json({ token: newToken });
}
