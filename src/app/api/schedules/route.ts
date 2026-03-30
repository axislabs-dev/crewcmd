import { NextResponse } from "next/server";
import { db } from "@/db";
import { cronJobs } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!db) return NextResponse.json({ jobs: [], total: 0 });
    const rows = await db.select().from(cronJobs).orderBy(cronJobs.name);
    // Map DB fields to shape the UI expects
    const jobs = rows.map((j) => ({
      ...j,
      sessionTarget: j.target ?? "isolated",
      state: {
        lastRunAtMs: j.lastRun ? new Date(j.lastRun).getTime() : undefined,
        nextRunAtMs: j.nextRun ? new Date(j.nextRun).getTime() : undefined,
        lastRunStatus: j.status ?? "ok",
      },
    }));
    return NextResponse.json({ jobs, total: jobs.length });
  } catch (err) {
    console.error("[api/schedules] DB error:", err);
    return NextResponse.json({ jobs: [], total: 0 });
  }
}
