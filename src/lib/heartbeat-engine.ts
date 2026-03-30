import { eq, and, lte, desc } from "drizzle-orm";
import { db } from "@/db";
import { heartbeatSchedules, heartbeatExecutions } from "@/db/schema";
import { logAudit } from "@/lib/governance";

// ─── Lightweight cron-next calculator ───────────────────────────────
// Supports standard 5-field cron: minute hour day-of-month month day-of-week
// Handles *, */N, N, and comma-separated values.

interface CronField {
  values: number[] | null; // null = wildcard (every)
}

function parseCronField(field: string, min: number, max: number): CronField {
  if (field === "*") return { values: null };

  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      // */N or M/N
      const [base, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const start = base === "*" ? min : parseInt(base, 10);
      for (let i = start; i <= max; i += step) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return { values: [...values].sort((a, b) => a - b) };
}

function fieldMatches(field: CronField, value: number): boolean {
  if (field.values === null) return true;
  return field.values.includes(value);
}

/**
 * Calculate the next execution time from a cron expression.
 * Returns a Date in UTC (timezone offsets handled at caller level if needed).
 */
export function calculateNextExecution(cronExpression: string, _timezone: string = "UTC"): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const minuteField = parseCronField(parts[0], 0, 59);
  const hourField = parseCronField(parts[1], 0, 23);
  const domField = parseCronField(parts[2], 1, 31);
  const monthField = parseCronField(parts[3], 1, 12);
  const dowField = parseCronField(parts[4], 0, 6);

  // Start from one minute after now
  const now = new Date();
  const candidate = new Date(now.getTime() + 60000);
  candidate.setUTCSeconds(0, 0);

  // Search forward up to 366 days
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const min = candidate.getUTCMinutes();
    const hour = candidate.getUTCHours();
    const dom = candidate.getUTCDate();
    const month = candidate.getUTCMonth() + 1;
    const dow = candidate.getUTCDay();

    if (
      fieldMatches(monthField, month) &&
      fieldMatches(domField, dom) &&
      fieldMatches(dowField, dow) &&
      fieldMatches(hourField, hour) &&
      fieldMatches(minuteField, min)
    ) {
      return candidate;
    }

    // Advance by 1 minute
    candidate.setTime(candidate.getTime() + 60000);
  }

  // Fallback: 24 hours from now
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Get all schedules that are due for execution.
 */
export async function getSchedulesDue(now: Date = new Date()) {
  if (!db) return [];

  return db
    .select()
    .from(heartbeatSchedules)
    .where(
      and(
        eq(heartbeatSchedules.enabled, true),
        lte(heartbeatSchedules.nextExecutionAt, now)
      )
    );
}

/**
 * Start a heartbeat execution for a schedule.
 */
export async function startExecution(scheduleId: string, agentId: string, companyId: string) {
  if (!db) return null;

  // Create execution record
  const [execution] = await db
    .insert(heartbeatExecutions)
    .values({
      scheduleId,
      agentId,
      companyId,
      status: "running",
      startedAt: new Date(),
    })
    .returning();

  // Get the schedule to calculate next execution
  const [schedule] = await db
    .select()
    .from(heartbeatSchedules)
    .where(eq(heartbeatSchedules.id, scheduleId))
    .limit(1);

  if (schedule) {
    const nextExecution = calculateNextExecution(schedule.schedule, schedule.timezone);
    await db
      .update(heartbeatSchedules)
      .set({
        lastExecutedAt: new Date(),
        nextExecutionAt: nextExecution,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatSchedules.id, scheduleId));
  }

  await logAudit(companyId, agentId, "started", "heartbeat_execution", execution.id, {
    scheduleId,
  });

  return execution;
}

/**
 * Complete a heartbeat execution with results.
 */
export async function completeExecution(
  executionId: string,
  results: {
    tasksDiscovered: number;
    tasksCompleted: number;
    actionsTaken: Record<string, unknown>;
  }
) {
  if (!db) return null;

  const [execution] = await db
    .update(heartbeatExecutions)
    .set({
      status: "completed",
      completedAt: new Date(),
      tasksDiscovered: results.tasksDiscovered,
      tasksCompleted: results.tasksCompleted,
      actionsTaken: results.actionsTaken,
    })
    .where(eq(heartbeatExecutions.id, executionId))
    .returning();

  if (execution) {
    await logAudit(execution.companyId, execution.agentId, "completed", "heartbeat_execution", executionId, {
      tasksDiscovered: results.tasksDiscovered,
      tasksCompleted: results.tasksCompleted,
    });
  }

  return execution ?? null;
}

/**
 * Mark a heartbeat execution as failed and optionally trigger escalation.
 */
export async function failExecution(executionId: string, error: string) {
  if (!db) return null;

  const [execution] = await db
    .update(heartbeatExecutions)
    .set({
      status: "failed",
      completedAt: new Date(),
      error,
    })
    .where(eq(heartbeatExecutions.id, executionId))
    .returning();

  if (execution) {
    await logAudit(execution.companyId, execution.agentId, "failed", "heartbeat_execution", executionId, {
      error,
    });
  }

  return execution ?? null;
}

/**
 * Mark a heartbeat execution as timed out.
 */
export async function timeoutExecution(executionId: string) {
  if (!db) return null;

  const [execution] = await db
    .update(heartbeatExecutions)
    .set({
      status: "timed_out",
      completedAt: new Date(),
      error: "Execution exceeded max duration",
    })
    .where(eq(heartbeatExecutions.id, executionId))
    .returning();

  if (execution) {
    await logAudit(execution.companyId, execution.agentId, "timed_out", "heartbeat_execution", executionId);
  }

  return execution ?? null;
}

/**
 * Get recent execution history for an agent.
 */
export async function getAgentExecutionHistory(agentId: string, companyId: string, limit: number = 20) {
  if (!db) return [];

  return db
    .select()
    .from(heartbeatExecutions)
    .where(
      and(
        eq(heartbeatExecutions.agentId, agentId),
        eq(heartbeatExecutions.companyId, companyId)
      )
    )
    .orderBy(desc(heartbeatExecutions.startedAt))
    .limit(limit);
}
