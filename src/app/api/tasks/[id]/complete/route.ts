/**
 * POST /api/tasks/{id}/complete
 *
 * Agent completion endpoint — agents submit a structured completion report.
 * The supervisor validates the report against the completion contract and
 * either accepts it (updating task metadata) or rejects it with retry guidance.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";
import {
  validateCompletionSchema,
  verifyTaskCompletion,
  evaluateSupervisorRejection,
  classifyCompletionOutcome,
  type AgentCompletionReport,
} from "@/lib/agent-completion-verification";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveTaskWhere(rawId: string) {
  const tskMatch = rawId.match(/^TSK-(\d+)$/i);
  return tskMatch
    ? eq(schema.tasks.shortId, parseInt(tskMatch[1], 10))
    : eq(schema.tasks.id, rawId);
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const report: AgentCompletionReport = {
      taskId: body.taskId ?? id,
      repo: body.repo ?? "",
      branch: body.branch ?? "",
      commits: Array.isArray(body.commits) ? body.commits : [],
      prUrl: body.prUrl ?? null,
      prNumber: body.prNumber ?? null,
      validationRun: body.validationRun ?? {
        ci: "pending",
        tests: "pending",
        lint: "pending",
        timestamp: new Date().toISOString(),
      },
      executionSuccess: body.executionSuccess ?? true,
      executionErrors: Array.isArray(body.executionErrors) ? body.executionErrors : [],
      notes: body.notes ?? "",
    };

    // Step 1: Validate the completion schema
    const schemaValidation = validateCompletionSchema(report);
    if (!schemaValidation.valid) {
      return NextResponse.json(
        {
          error: "Invalid completion report schema",
          issues: schemaValidation.errors,
          retrySuggestion: "Ensure all required fields (taskId, repo, branch) are provided",
        },
        { status: 400 }
      );
    }

    // Step 2: Resolve the task
    const whereClause = await resolveTaskWhere(id);
    const [task] = await db.select().from(schema.tasks).where(whereClause);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Step 3: Verify task completion against the contract
    const taskValidation = await verifyTaskCompletion(id, task.assignedAgentId);

    // Step 4: Supervisor evaluation
    const rejection = evaluateSupervisorRejection(taskValidation, "review");
    if (rejection.rejected) {
      return NextResponse.json(
        {
          error: rejection.reason,
          retrySuggestion: rejection.retrySuggestion,
          validationErrors: taskValidation.errors,
          validationWarnings: taskValidation.warnings,
          schemaWarnings: schemaValidation.warnings,
        },
        { status: 400 }
      );
    }

    // Step 5: Classify outcome
    const outcome = classifyCompletionOutcome(report.executionSuccess, taskValidation);

    // Step 6: Update task metadata with completion report data
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (report.repo) updates.repo = report.repo;
    if (report.branch) updates.branch = report.branch;
    if (report.prUrl) updates.prUrl = report.prUrl;
    if (report.notes) {
      updates.reviewNotes = report.notes;
    }

    const [updatedTask] = await db
      .update(schema.tasks)
      .set(updates)
      .where(whereClause)
      .returning();

    // Step 7: Log completion activity
    await db.insert(schema.activityLog).values({
      agentId: task.assignedAgentId || "system",
      actionType: "completion_report_submitted",
      description: `Completion report for task: ${task.title} — outcome: ${outcome.humanReadable}`,
      metadata: {
        taskId: task.id,
        outcome: outcome.outcome,
        prUrl: report.prUrl,
        branch: report.branch,
        repo: report.repo,
        commits: report.commits.length,
        executionSuccess: report.executionSuccess,
        validationRun: report.validationRun,
        warnings: [...schemaValidation.warnings, ...taskValidation.warnings],
      },
    }).catch(() => {});

    // Step 8: Add a task comment summarizing the completion
    if (updatedTask) {
      await db.insert(schema.taskComments).values({
        taskId: updatedTask.id,
        agentId: task.assignedAgentId || null,
        content: [
          `🛡️ **Completion Report Submitted**`,
          ``,
          `**Outcome:** ${outcome.humanReadable}`,
          `**Repo:** ${report.repo}`,
          `**Branch:** ${report.branch}`,
          `**PR:** ${report.prUrl || "N/A"}`,
          `**Commits:** ${report.commits.length}`,
          `**Validation:** CI=${report.validationRun.ci}, Tests=${report.validationRun.tests}, Lint=${report.validationRun.lint}`,
          report.notes ? `**Notes:** ${report.notes}` : "",
        ].filter(Boolean).join("\n"),
      }).catch(() => {});
    }

    return NextResponse.json({
      accepted: true,
      task: updatedTask,
      outcome,
      warnings: [...schemaValidation.warnings, ...taskValidation.warnings],
    });
  } catch (error) {
    console.error("[api/tasks/id/complete] Error:", error);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
