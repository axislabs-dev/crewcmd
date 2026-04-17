import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { requireAuth } from "@/lib/require-auth";
import type { InboxMessage } from "@/db/schema-inbox";

export const dynamic = "force-dynamic";

/** Priority sort order: critical first */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * GET /api/inbox — List inbox messages for a company.
 * Query params: company_id, status, priority, type, limit, offset
 * Returns real data only.
 */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const conditions: string[] = [];
    if (companyId) conditions.push(`company_id = '${companyId}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `SELECT
          id,
          company_id AS "companyId",
          from_agent_id AS "fromAgentId",
          to_user_id AS "toUserId",
          to_agent_id AS "toAgentId",
          type,
          priority,
          title,
          body,
          context,
          actions,
          status,
          actioned_by AS "actionedBy",
          actioned_at AS "actionedAt",
          action_result AS "actionResult",
          snooze_until AS "snoozeUntil",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM inbox_messages
        ${where}
        ORDER BY created_at DESC`
      ))
    );

    const rows = (result.rows ?? []) as unknown as InboxMessage[];
    let messages: InboxMessage[] = [...rows];

    // Apply filters
    if (status) {
      messages = messages.filter((m) => m.status === status);
    }
    if (priority) {
      messages = messages.filter((m) => m.priority === priority);
    }
    if (type) {
      messages = messages.filter((m) => m.type === type);
    }

    // Sort: priority (critical first), then createdAt desc
    messages.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Paginate
    const paginated = messages.slice(offset, offset + limit);

    return NextResponse.json(paginated);
  } catch (error) {
    console.error("[api/inbox] GET error:", error);
    return NextResponse.json([]);
  }
}

/**
 * POST /api/inbox — Create a new inbox message.
 * Body: { companyId, fromAgentId, toUserId?, toAgentId?, type, priority, title, body, context?, actions? }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.companyId || !body.fromAgentId || !body.type || !body.title || !body.body) {
      return NextResponse.json(
        { error: "companyId, fromAgentId, type, title, and body are required" },
        { status: 400 }
      );
    }

    const validTypes = ["decision", "blocker", "completed", "question", "escalation", "update", "approval"];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
    }

    const validPriorities = ["critical", "high", "normal", "low"];
    const priorityVal = body.priority || "normal";
    if (!validPriorities.includes(priorityVal)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` },
        { status: 400 }
      );
    }

    const toUserId = body.toUserId ? `'${body.toUserId}'` : "NULL";
    const toAgentId = body.toAgentId ? `'${body.toAgentId}'` : "NULL";
    const contextVal = body.context ? `'${JSON.stringify(body.context).replace(/'/g, "''")}'::jsonb` : "NULL";
    const actionsVal = body.actions ? `'${JSON.stringify(body.actions).replace(/'/g, "''")}'::jsonb` : "NULL";

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        INSERT INTO inbox_messages (company_id, from_agent_id, to_user_id, to_agent_id, type, priority, title, body, context, actions)
        VALUES (
          '${body.companyId}',
          '${body.fromAgentId}',
          ${toUserId},
          ${toAgentId},
          '${body.type}',
          '${priorityVal}',
          '${String(body.title).replace(/'/g, "''")}',
          '${String(body.body).replace(/'/g, "''")}',
          ${contextVal},
          ${actionsVal}
        )
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
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    console.error("[api/inbox] POST error:", error);
    return NextResponse.json({ error: "Failed to create inbox message" }, { status: 500 });
  }
}
