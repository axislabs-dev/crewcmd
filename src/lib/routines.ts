import { eq, and, lte } from "drizzle-orm";
import { db } from "@/db";
import { routineTemplates, tasks } from "@/db/schema";
import { calculateNextExecution } from "@/lib/heartbeat-engine";
import { logAudit } from "@/lib/governance";

/**
 * Get all routines that are due for task creation.
 */
export async function getRoutinesDue(now: Date = new Date()) {
  if (!db) return [];

  return db
    .select()
    .from(routineTemplates)
    .where(
      and(
        eq(routineTemplates.enabled, true),
        lte(routineTemplates.nextCreateAt, now)
      )
    );
}

/**
 * Execute a routine — create a task from the template and update scheduling.
 */
export async function executeRoutine(templateId: string) {
  if (!db) return null;

  const [template] = await db
    .select()
    .from(routineTemplates)
    .where(eq(routineTemplates.id, templateId))
    .limit(1);

  if (!template || !template.enabled) return null;

  const tpl = template.taskTemplate;

  // Resolve title pattern (replace {{date}} with today's date)
  const today = new Date().toISOString().split("T")[0];
  const title = tpl.titlePattern.replace(/\{\{date\}\}/g, today);

  // Create the task
  const [task] = await db
    .insert(tasks)
    .values({
      title,
      description: tpl.description,
      status: "inbox",
      priority: tpl.priority,
      assignedAgentId: tpl.assigneeAgentId,
      projectId: tpl.projectId,
      companyId: template.companyId,
      source: "agent_initiative",
      createdBy: "routine",
    })
    .returning();

  // Update routine schedule
  const nextCreate = calculateNextExecution(template.schedule);
  await db
    .update(routineTemplates)
    .set({
      lastCreatedAt: new Date(),
      nextCreateAt: nextCreate,
      updatedAt: new Date(),
    })
    .where(eq(routineTemplates.id, templateId));

  await logAudit(template.companyId, "routine", "created", "task", task.id, {
    routineId: templateId,
    routineTitle: template.title,
  });

  return task;
}

/**
 * Calculate the next creation time from a cron expression.
 */
export function calculateNextCreate(cronExpression: string): Date {
  return calculateNextExecution(cronExpression);
}
