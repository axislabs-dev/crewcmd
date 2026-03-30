import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const humanAssignee = searchParams.get("humanAssignee");
  const taskId = searchParams.get("taskId");
  const activeOnly = searchParams.get("active") === "true";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = searchParams.get("limit");

  try {
    let result = await withRetry(() =>
      db!.select().from(schema.timeEntries)
    );

    if (humanAssignee) {
      result = result.filter((e) => e.humanAssignee === humanAssignee);
    }
    if (taskId) {
      result = result.filter((e) => e.taskId === taskId);
    }
    if (activeOnly) {
      result = result.filter((e) => !e.stoppedAt);
    }
    if (from) {
      const fromMs = new Date(from).getTime();
      result = result.filter(
        (e) => new Date(e.startedAt).getTime() >= fromMs
      );
    }
    if (to) {
      const toMs = new Date(to).getTime();
      result = result.filter(
        (e) => new Date(e.startedAt).getTime() <= toMs
      );
    }

    result.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    if (limit) {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) {
        result = result.slice(0, n);
      }
    }

    const totalSeconds = result.reduce(
      (sum, e) => sum + (e.durationSeconds ?? 0),
      0
    );

    return NextResponse.json({
      entries: result,
      totalSeconds,
      count: result.length,
    });
  } catch (error) {
    console.error("[api/time-entries] Database error:", error);
    return NextResponse.json({ entries: [], totalSeconds: 0, count: 0 });
  }
}
