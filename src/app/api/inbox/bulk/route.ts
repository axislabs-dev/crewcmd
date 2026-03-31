import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/inbox/bulk — Bulk actions on inbox messages.
 * Body: { ids: string[], action: 'read' | 'dismiss' | 'snooze', snoozeUntil? }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }

    const validActions = ["read", "dismiss", "snooze"];
    if (!validActions.includes(body.action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const statusMap: Record<string, string> = {
      read: "read",
      dismiss: "dismissed",
      snooze: "snoozed",
    };
    const status = statusMap[body.action];

    const idList = body.ids.map((id: string) => `'${id}'`).join(", ");

    let extraSet = "";
    if (body.action === "snooze" && body.snoozeUntil) {
      extraSet = `, snooze_until = '${body.snoozeUntil}'::timestamptz`;
    }

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `UPDATE inbox_messages
         SET status = '${status}', updated_at = now()${extraSet}
         WHERE id IN (${idList})
         RETURNING id`
      ))
    );

    const rows = (result.rows ?? []) as unknown as Array<{ id: string }>;

    return NextResponse.json({ updated: rows.length });
  } catch (error) {
    console.error("[api/inbox/bulk] POST error:", error);
    return NextResponse.json({ error: "Failed to perform bulk action" }, { status: 500 });
  }
}
