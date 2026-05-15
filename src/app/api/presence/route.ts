import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { userPresence } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["active", "focus", "meeting", "away", "sick", "sleep"]);

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalDate(value: unknown) {
  if (!value) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializePresence(row: typeof userPresence.$inferSelect | undefined) {
  if (!row) return null;
  const stale = Date.now() - row.lastSeenAt.getTime() > 90_000;
  const manualExpired = row.manualExpiresAt ? row.manualExpiresAt.getTime() <= Date.now() : false;
  return {
    status: stale ? "offline" : manualExpired ? "active" : row.status,
    customText: manualExpired ? null : row.customText,
    emoji: manualExpired ? null : row.emoji,
    manualExpiresAt: manualExpired ? null : row.manualExpiresAt,
    lastSeenAt: row.lastSeenAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await withRetry(() =>
    db!
      .select()
      .from(userPresence)
      .where(eq(userPresence.userId, user.id))
      .limit(1)
  );

  return NextResponse.json({ presence: serializePresence(row) });
}

export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await resolveCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const status = readString(body.status) || "active";
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid presence status" }, { status: 400 });
  }

  const customText = readString(body.customText);
  const emoji = readString(body.emoji);
  const manualExpiresAt = readOptionalDate(body.manualExpiresAt);
  const now = new Date();

  const values = {
    userId: user.id,
    status,
    customText: customText || null,
    emoji: emoji || null,
    manualExpiresAt,
    lastSeenAt: now,
    updatedAt: now,
  };

  const [row] = await withRetry(() =>
    db!
      .insert(userPresence)
      .values(values)
      .onConflictDoUpdate({
        target: userPresence.userId,
        set: values,
      })
      .returning()
  );

  return NextResponse.json({ presence: serializePresence(row) });
}
