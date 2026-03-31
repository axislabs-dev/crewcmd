import { NextResponse } from "next/server";
import { and, eq, lt, isNull, inArray } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// Round-robin state for agent-forge/blitz assignment
let forgeBlitzRoundRobin = 0;

/**
 * Get project name by ID for agent assignment logic.
 */
async function getProjectName(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;

  const projects = await withRetry(() =>
    db!.select().from(schema.projects).where(eq(schema.projects.id, projectId))
  );

  return projects.length > 0 ? projects[0].name : null;
}

/**
 * Triage cron — runs periodically to maintain task health.
 *
 * Pass 1: Auto-assignment
 *   Finds inbox/queued tasks without assignedAgentId and assigns them
 *   based on project + keyword rules. Skips tasks with humanAssignee set.
 *
 * Pass 2: Stale task recovery
 *   Detects tasks stuck in_progress with no PR for >2 hours
 *   (agent/gateway crash left them orphaned) and resets to queued
 *   so dispatch can pick them up again.
 */
export async function GET() {
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // =====================
    // PASS 1: Auto-assignment
    // =====================
    const unassignedTasks = await withRetry(() =>
      db!.select().from(schema.tasks).where(
        and(
          inArray(schema.tasks.status, ["inbox", "queued"]),
          isNull(schema.tasks.assignedAgentId),
          isNull(schema.tasks.humanAssignee) // Skip human work
        )
      )
    );

    const assigned: Array<{ taskId: string; title: string; agent: string }> = [];

    for (const task of unassignedTasks) {
      const projectName = await getProjectName(task.projectId);
      let agent: string | null = null;

      const titleLower = task.title.toLowerCase();

      // PR review tasks → agent-sentinel (strict word-boundary match)
      if (/\bpr[\s-]?review\b/.test(titleLower) || /\bsentinel\b/.test(titleLower)) {
        agent = "agent-sentinel";
      }
      // Thoroughbreds.ai project → agent-forge or agent-blitz (round-robin)
      else if (projectName === "Thoroughbreds.ai") {
        agent = forgeBlitzRoundRobin % 2 === 0 ? "agent-forge" : "agent-blitz";
        forgeBlitzRoundRobin++;
      }
      // ClutchCut project → agent-cipher
      else if (projectName === "ClutchCut") {
        agent = "agent-cipher";
      }
      // CrewCmd project → agent-forge or agent-blitz (round-robin)
      else if (projectName === "CrewCmd") {
        agent = forgeBlitzRoundRobin % 2 === 0 ? "agent-forge" : "agent-blitz";
        forgeBlitzRoundRobin++;
      }
      // Quant Trading project → agent-maverick or agent-axiom
      else if (projectName === "Quant Trading") {
        agent = "agent-maverick"; // Default to maverick for quant
      }
      // Default Portfolio / generic → agent-blitz
      else if (
        projectName === "Default Portfolio" ||
        projectName === "Default" ||
        !projectName
      ) {
        agent = "agent-blitz";
      }

      if (agent) {
        // Update task with assigned agent and move to queued
        await withRetry(() =>
          db!
            .update(schema.tasks)
            .set({
              assignedAgentId: agent,
              status: "queued",
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, task.id))
        );

        // Log the assignment
        await db!
          .insert(schema.activityLog)
          .values({
            agentId: "system",
            actionType: "task_assigned",
            description: `Auto-assigned task to ${agent}: ${task.title}`,
            metadata: {
              taskId: task.id,
              assignedAgent: agent,
              projectName: projectName,
              reason: "auto_assignment",
            },
          })
          .catch((err) => console.error("[cron/triage] activityLog insert error:", err));

        assigned.push({ taskId: task.id, title: task.title, agent });
      }
    }

    // =====================
    // PASS 2: Stale task recovery
    // =====================
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    // Find stale in_progress tasks: no PR and not updated in >2h
    const staleTasks = await withRetry(() =>
      db!.select().from(schema.tasks).where(
        and(
          eq(schema.tasks.status, "in_progress"),
          isNull(schema.tasks.prUrl),
          lt(schema.tasks.updatedAt, cutoff)
        )
      )
    );

    const recovered: string[] = [];

    for (const task of staleTasks) {
      await withRetry(() =>
        db!
          .update(schema.tasks)
          .set({ status: "queued", updatedAt: new Date() })
          .where(eq(schema.tasks.id, task.id))
      );

      await db!
        .insert(schema.activityLog)
        .values({
          agentId: "system",
          actionType: "task_queued",
          description: `Auto-recovered stale task: ${task.title}`,
          metadata: {
            taskId: task.id,
            previousStatus: "in_progress",
            reason: "stale_recovery",
            staleSince: task.updatedAt?.toISOString(),
          },
        })
        .catch((err) => console.error("[cron/triage] activityLog insert error:", err));

      recovered.push(task.id);
    }

    return NextResponse.json({
      autoAssigned: assigned.length,
      assignedTasks: assigned,
      recovered: recovered.length,
      recoveredTaskIds: recovered,
    });
  } catch (error) {
    console.error("[cron/triage] Error:", error);
    return NextResponse.json({ error: "Triage cron failed" }, { status: 500 });
  }
}
