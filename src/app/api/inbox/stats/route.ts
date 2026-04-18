import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import type { InboxStats, InboxPriority, InboxMessageType } from "@/db/schema-inbox";
import {
  isHeartbeatBearerRequest,
  resolveAccessibleWorkspace,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** Default empty stats object */
function emptyStats(): InboxStats {
  return {
    total: 0,
    byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
    byType: { decision: 0, blocker: 0, completed: 0, question: 0, escalation: 0, update: 0, approval: 0 },
  };
}

/**
 * GET /api/inbox/stats — Unread message counts by priority and type.
 * Query params: workspaceId/company_id
 */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json(emptyStats());

  const { searchParams } = new URL(request.url);
  const requestedCompanyId =
    searchParams.get("companyId") ??
    searchParams.get("company_id");
  const requestedWorkspaceId = searchParams.get("workspaceId");

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
          { error: "workspaceId or companyId is required for bearer-scoped inbox stats" },
          { status: 400 }
        );
      }
      return NextResponse.json(emptyStats());
    }

    const workspaceFilter = ` AND workspace_id = '${workspace.id}'`;

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `SELECT priority, type, COUNT(*)::int as count
         FROM inbox_messages
         WHERE status = 'unread'${workspaceFilter}
         GROUP BY priority, type`
      ))
    );

    const rows = (result.rows ?? []) as unknown as Array<{ priority: string; type: string; count: number }>;

    if (rows.length === 0) return NextResponse.json(emptyStats());

    const stats = emptyStats();

    for (const row of rows) {
      const count = Number(row.count);
      stats.total += count;

      if (row.priority in stats.byPriority) {
        stats.byPriority[row.priority as InboxPriority] += count;
      }
      if (row.type in stats.byType) {
        stats.byType[row.type as InboxMessageType] += count;
      }
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error("[api/inbox/stats] GET error:", error);
    return NextResponse.json(emptyStats());
  }
}
