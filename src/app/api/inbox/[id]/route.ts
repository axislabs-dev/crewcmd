import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import type { InboxMessage } from "@/db/schema-inbox";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/inbox/[id] — Update an inbox message.
 * Body: { status?, actionResult?, snoozeUntil?, actionedBy? }
 * When status='actioned', automatically sets actionedBy and actionedAt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const body = await request.json();

    const setClauses: string[] = ["updated_at = now()"];

    if (body.status !== undefined) {
      setClauses.push(`status = '${body.status}'`);

      if (body.status === "actioned") {
        setClauses.push("actioned_at = now()");
        setClauses.push(`actioned_by = '${body.actionedBy || "user"}'`);
      }
    }

    if (body.actionResult !== undefined) {
      setClauses.push(`action_result = '${String(body.actionResult).replace(/'/g, "''")}'`);
    }

    if (body.snoozeUntil !== undefined) {
      setClauses.push(`snooze_until = '${body.snoozeUntil}'::timestamptz`);
    }

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        UPDATE inbox_messages
        SET ${setClauses.join(", ")}
        WHERE id = '${id}'
        RETURNING
          id,
          company_id AS "companyId",
          from_agent_id AS "fromAgentId",
          to_user_id AS "toUserId",
          to_agent_id AS "toAgentId",
          type, priority, title, body, context, actions, status,
          actioned_by AS "actionedBy",
          actioned_at AS "actionedAt",
          action_result AS "actionResult",
          snooze_until AS "snoozeUntil",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `))
    );

    const rows = (result.rows ?? []) as unknown as InboxMessage[];

    if (rows.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("[api/inbox/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
