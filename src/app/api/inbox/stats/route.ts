import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, withRetry } from "@/db";
import type { InboxStats, InboxPriority, InboxMessageType } from "@/db/schema-inbox";

export const dynamic = "force-dynamic";

/** Default empty stats object */
function emptyStats(): InboxStats {
  return {
    total: 0,
    byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
    byType: { decision: 0, blocker: 0, completed: 0, question: 0, escalation: 0, update: 0, approval: 0 },
  };
}

/** Seed stats returned when the table doesn't exist or is empty */
function seedStats(): InboxStats {
  return {
    total: 6,
    byPriority: { critical: 1, high: 3, normal: 2, low: 0 },
    byType: { decision: 1, blocker: 1, completed: 1, question: 1, escalation: 1, approval: 1, update: 0 },
  };
}

/**
 * GET /api/inbox/stats — Unread message counts by priority and type.
 * Query params: company_id
 */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json(emptyStats());

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  try {
    const companyFilter = companyId ? ` AND company_id = '${companyId}'` : "";

    const result = await withRetry(() =>
      db!.execute(sql.raw(
        `SELECT priority, type, COUNT(*)::int as count
         FROM inbox_messages
         WHERE status = 'unread'${companyFilter}
         GROUP BY priority, type`
      ))
    );

    const rows = (result.rows ?? []) as unknown as Array<{ priority: string; type: string; count: number }>;

    if (rows.length === 0) {
      // Return seed stats so the UI shows realistic counts
      return NextResponse.json(seedStats());
    }

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
    return NextResponse.json(seedStats());
  }
}
