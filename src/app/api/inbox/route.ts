import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, withRetry } from "@/db";
import { requireUserOrRuntimeAuth } from "@/lib/require-auth";
import type { InboxMessage } from "@/db/schema-inbox";
import { normalizeInboxMessage, normalizeInboxMessages } from "@/lib/inbox-response";
import { extractSqlRows } from "@/lib/sql-result";
import {
  getCompanyIdForWorkspace,
  isHeartbeatBearerRequest,
  resolveAccessibleWorkspace,
} from "@/lib/workspace";

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
 * Query params: workspaceId/company_id, status, priority, type, limit, offset
 * Returns real data only.
 */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const requestedCompanyId =
    searchParams.get("companyId") ??
    searchParams.get("company_id");
  const requestedWorkspaceId = searchParams.get("workspaceId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const heartbeat = await isHeartbeatBearerRequest(request);
    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: requestedWorkspaceId,
      explicitCompanyId: requestedCompanyId,
      requireExplicitForBearer: true,
    });

    if (!workspace) {
      if (heartbeat && !requestedCompanyId && !requestedWorkspaceId) {
        return NextResponse.json(
          { error: "workspaceId or companyId is required for bearer-scoped inbox listing" },
          { status: 400 }
        );
      }
      return NextResponse.json([]);
    }

    const conditions: string[] = [];
    conditions.push(`workspace_id = '${workspace.id}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `SELECT
          inbox_messages.id,
          inbox_messages.workspace_id AS "workspaceId",
          inbox_messages.company_id AS "companyId",
          inbox_messages.from_agent_id AS "fromAgentId",
          CASE
            WHEN a.id IS NOT NULL THEN json_build_object(
              'id', a.id,
              'callsign', a.callsign,
              'name', a.name,
              'emoji', a.emoji,
              'color', a.color
            )
            ELSE NULL
          END AS "fromAgent",
          inbox_messages.to_user_id AS "toUserId",
          inbox_messages.to_agent_id AS "toAgentId",
          inbox_messages.type,
          inbox_messages.priority,
          inbox_messages.title,
          inbox_messages.body,
          inbox_messages.context,
          inbox_messages.actions,
          inbox_messages.status,
          inbox_messages.actioned_by AS "actionedBy",
          inbox_messages.actioned_at AS "actionedAt",
          inbox_messages.action_result AS "actionResult",
          inbox_messages.snooze_until AS "snoozeUntil",
          inbox_messages.created_at AS "createdAt",
          inbox_messages.updated_at AS "updatedAt"
        FROM inbox_messages
        LEFT JOIN agents a
          ON a.id::text = inbox_messages.from_agent_id
          OR lower(a.callsign) = lower(inbox_messages.from_agent_id)
        ${where}
        ORDER BY created_at DESC`
      ))
    );

    const rows = extractSqlRows<InboxMessage>(result);
    let messages: InboxMessage[] = normalizeInboxMessages(rows);

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
 * Body: { workspaceId?, companyId?, fromAgentId, toUserId?, toAgentId?, type, priority, title, body, context?, actions? }
 */
export async function POST(request: NextRequest) {
  const authError = await requireUserOrRuntimeAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    if (!body.fromAgentId || !body.type || !body.title || !body.body) {
      return NextResponse.json(
        { error: "fromAgentId, type, title, and body are required" },
        { status: 400 }
      );
    }

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: body.workspaceId ?? null,
      explicitCompanyId: body.companyId ?? null,
    });

    if (!workspace) {
      return NextResponse.json({ error: "workspaceId or companyId is required" }, { status: 400 });
    }
    const companyId = workspace.companyId ?? await getCompanyIdForWorkspace(workspace.id);

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
    const messageId = randomUUID();

    await withRetry(() =>
      db!.execute(sql.raw(`
        INSERT INTO inbox_messages (id, workspace_id, company_id, from_agent_id, to_user_id, to_agent_id, type, priority, title, body, context, actions)
        VALUES (
          '${messageId}',
          '${workspace.id}',
          ${companyId ? `'${companyId}'` : "NULL"},
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
      `))
    );

    const result = await withRetry(() =>
      db!.execute(sql.raw(`
        SELECT
          inbox_messages.id,
          inbox_messages.workspace_id AS "workspaceId",
          inbox_messages.company_id AS "companyId",
          inbox_messages.from_agent_id AS "fromAgentId",
          CASE
            WHEN a.id IS NOT NULL THEN json_build_object(
              'id', a.id,
              'callsign', a.callsign,
              'name', a.name,
              'emoji', a.emoji,
              'color', a.color
            )
            ELSE NULL
          END AS "fromAgent",
          inbox_messages.to_user_id AS "toUserId",
          inbox_messages.to_agent_id AS "toAgentId",
          inbox_messages.type, inbox_messages.priority, inbox_messages.title, inbox_messages.body, inbox_messages.context, inbox_messages.actions, inbox_messages.status,
          inbox_messages.actioned_by AS "actionedBy",
          inbox_messages.actioned_at AS "actionedAt",
          inbox_messages.action_result AS "actionResult",
          inbox_messages.snooze_until AS "snoozeUntil",
          inbox_messages.created_at AS "createdAt",
          inbox_messages.updated_at AS "updatedAt"
        FROM inbox_messages
        LEFT JOIN agents a
          ON a.id::text = inbox_messages.from_agent_id
          OR lower(a.callsign) = lower(inbox_messages.from_agent_id)
        WHERE inbox_messages.id = '${messageId}'
      `))
    );

    const rows = extractSqlRows<InboxMessage>(result);
    const message = normalizeInboxMessage(rows[0]);
    if (!message) {
      return NextResponse.json({ error: "Inbox message insert did not return a row" }, { status: 500 });
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("[api/inbox] POST error:", error);
    return NextResponse.json({ error: "Failed to create inbox message" }, { status: 500 });
  }
}
