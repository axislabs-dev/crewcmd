import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
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

async function syncFromOpenClaw(): Promise<{ upserted: number; deleted: number }> {
  if (!db) throw new Error("Database not configured");

  const raw = execSync("openclaw cron list --json", {
    timeout: 15000,
    encoding: "utf-8",
    env: { ...process.env },
  });

  const parsed = JSON.parse(raw);
  const jobs: Record<string, unknown>[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.jobs)
      ? parsed.jobs
      : [];

  const incomingIds = jobs.map((j) => j.id as string);

  for (const job of jobs) {
    const state = (job.state ?? {}) as Record<string, unknown>;
    await db.insert(cronJobs).values({
      id: job.id as string,
      name: job.name as string,
      schedule: humanSchedule((job.schedule ?? {}) as Record<string, unknown>),
      status: (state.lastRunStatus as string) ?? "ok",
      enabled: job.enabled !== false,
      lastRun: state.lastRunAtMs ? new Date(state.lastRunAtMs as number) : null,
      nextRun: state.nextRunAtMs ? new Date(state.nextRunAtMs as number) : null,
      target: (job.sessionTarget ?? job.target ?? null) as string | null,
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

  let deleted = 0;
  if (incomingIds.length > 0) {
    const result = await db.delete(cronJobs).where(notInArray(cronJobs.id, incomingIds));
    deleted = result.rowCount ?? 0;
  }

  return { upserted: jobs.length, deleted };
}

export async function POST(req: NextRequest) {
  const secret = process.env.HEARTBEAT_SECRET;
  if (!secret) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncFromOpenClaw();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/automations/sync] Error:", err);
    return NextResponse.json({ error: "Failed to sync from OpenClaw" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await syncFromOpenClaw();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/automations/sync] Error:", err);
    return NextResponse.json({ error: "Failed to sync from OpenClaw" }, { status: 500 });
  }
}
