import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cronJobs } from "@/db/schema";
import { sql, notInArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function humanSchedule(sched: Record<string, unknown>): string {
  if (!sched || typeof sched !== "object") return "unknown";
  if (sched.kind === "every" && sched.everyMs) {
    const ms = sched.everyMs as number;
    if (ms < 60000) return `every ${ms / 1000}s`;
    if (ms < 3600000) return `every ${ms / 60000}m`;
    if (ms < 86400000) return `every ${ms / 3600000}h`;
    return `every ${ms / 86400000}d`;
  }
  if (sched.kind === "cron" && sched.expr) {
    return `cron: ${sched.expr}${sched.tz ? ` (${sched.tz})` : ""}`;
  }
  if (sched.kind === "at") return `at ${sched.at ?? "unknown"}`;
  return "unknown";
}

export async function POST(req: NextRequest) {
  const secret = process.env.HEARTBEAT_SECRET;
  if (!secret) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  try {
    const body = await req.json();
    const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    const incomingIds = jobs.map((j: Record<string, unknown>) => j.id as string);

    // Upsert all current jobs
    for (const job of jobs) {
      await db.insert(cronJobs).values({
        id: job.id,
        name: job.name,
        schedule: humanSchedule(job.schedule ?? {}),
        status: job.state?.lastRunStatus ?? "ok",
        enabled: job.enabled !== false,
        lastRun: job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs) : null,
        nextRun: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs) : null,
        target: job.sessionTarget ?? job.target ?? null,
        raw: job,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: cronJobs.id,
        set: {
          name: sql`excluded.name`,
          schedule: sql`excluded.schedule`,
          status: sql`excluded.status`,
          enabled: sql`excluded.enabled`,
          lastRun: sql`excluded.last_run`,
          nextRun: sql`excluded.next_run`,
          target: sql`excluded.target`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }

    // Delete stale entries not in this push
    let deleted = 0;
    if (incomingIds.length > 0) {
      const result = await db.delete(cronJobs).where(notInArray(cronJobs.id, incomingIds));
      deleted = result.rowCount ?? 0;
    }

    return NextResponse.json({ ok: true, upserted: jobs.length, deleted });
  } catch (err) {
    console.error("[api/schedules/push] Error:", err);
    return NextResponse.json({ error: "Failed to process schedules" }, { status: 500 });
  }
}
