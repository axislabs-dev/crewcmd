import { NextResponse } from "next/server";
import { eq, and, isNull, or } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

const MAVERICK_AGENT_ID = "agent-maverick";

/**
 * Axiom research cron — creates Quant R&D tasks assigned to Maverick.
 * Always sets assignedAgentId so dispatch routes correctly.
 * Deduplicates: skips if an active Quant R&D task already exists (inbox or queued).
 */
export async function GET() {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // Check for existing incomplete Quant R&D tasks (inbox OR queued)
    const existingTasks = await withRetry(() =>
      db!
        .select()
        .from(schema.tasks)
        .where(
          and(
            or(eq(schema.tasks.status, "inbox"), eq(schema.tasks.status, "queued")),
            isNull(schema.tasks.projectId)
          )
        )
    );

    const hasActiveQuantTask = existingTasks.some(
      (t) =>
        t.title.toLowerCase().includes("quant") ||
        t.title.toLowerCase().includes("research") ||
        t.title.toLowerCase().includes("backtest") ||
        t.description?.toLowerCase().includes("quant")
    );

    if (hasActiveQuantTask) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Active Quant R&D task already exists" });
    }

    const taskTitle = `Quant R&D Cycle — ${new Date().toLocaleDateString("en-AU", { month: "long", day: "numeric", year: "numeric" })}`;

    const [task] = await withRetry(() =>
      db!
        .insert(schema.tasks)
        .values({
          title: taskTitle,
          description: "Quantitative research cycle. Generate hypotheses, run backtests, identify edges. Report findings.",
          status: "queued",
          priority: "medium",
          assignedAgentId: MAVERICK_AGENT_ID,
          createdBy: "cron-axiom-research",
        })
        .returning()
    );

    await withRetry(() =>
      db!.insert(schema.activityLog).values({
        agentId: "system",
        actionType: "task_created",
        description: `Quant R&D task created: ${task.title}`,
        metadata: { taskId: task.id, assignedTo: MAVERICK_AGENT_ID },
      })
    );

    return NextResponse.json({ ok: true, created: task.id, title: task.title });
  } catch (error) {
    console.error("[axiom-research] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
