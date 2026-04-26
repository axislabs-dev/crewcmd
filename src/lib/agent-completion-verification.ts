/**
 * Agent Completion Verification
 * 
 * Enforces a machine-verifiable completion contract for coding agents.
 * A task cannot be surfaced as done/review-ready unless required delivery
 * metadata is verified against git/GitHub/CrewCmd.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

// ─── Completion Schema ──────────────────────────────────────────────

export interface AgentCompletionReport {
  taskId: string;
  repo: string;
  branch: string;
  commits: Array<{
    hash: string;
    message: string;
  }>;
  prUrl: string | null;
  prNumber: number | null;
  validationRun: {
    ci: "pass" | "fail" | "pending" | "skipped";
    tests: "pass" | "fail" | "pending" | "skipped";
    lint: "pass" | "fail" | "pending" | "skipped";
    timestamp: string;
  };
  executionSuccess: boolean;
  executionErrors: string[];
  notes: string;
}

export interface CompletionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  task?: typeof schema.tasks.$inferSelect;
}

// ─── Schema Enforcement ─────────────────────────────────────────────

export function validateCompletionSchema(
  report: AgentCompletionReport
): CompletionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!report.taskId) {
    errors.push("taskId is required");
  }
  if (!report.repo) {
    errors.push("repo is required");
  }
  if (!report.branch) {
    errors.push("branch is required");
  }

  // PR validation for code-delivery tasks
  if (!report.prUrl && !report.prNumber) {
    warnings.push("No PR URL or PR number provided — code delivery may be incomplete");
  }

  // Commit validation
  if (!report.commits || report.commits.length === 0) {
    warnings.push("No commits reported — task may not have produced code changes");
  } else {
    // Validate commit hash format (7+ hex chars)
    report.commits.forEach((commit, idx) => {
      if (!/^[a-f0-9]{7,40}$/i.test(commit.hash)) {
        errors.push(`Commit ${idx} has invalid hash format: ${commit.hash}`);
      }
    });
  }

  // Execution vs report separation
  if (!report.executionSuccess && report.executionErrors.length === 0) {
    warnings.push("executionSuccess is false but no executionErrors provided");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Task-Level Verification ────────────────────────────────────────

/**
 * Verifies a task meets the completion contract before allowing
 * status transition to "review" or "done".
 * 
 * For developer/reviewer role-pack agents, PR URL is mandatory.
 * For all agents, branch and repo must be set if any code work was done.
 */
export async function verifyTaskCompletion(
  taskId: string,
  assignedAgentId: string | null
): Promise<CompletionValidationResult> {
  if (!db) {
    return {
      valid: false,
      errors: ["Database not configured"],
      warnings: [],
    };
  }

  // Resolve task by ID or shortId
  const tskMatch = taskId.match(/^TSK-(\d+)$/i);
  const whereClause = tskMatch
    ? eq(schema.tasks.shortId, parseInt(tskMatch[1], 10))
    : eq(schema.tasks.id, taskId);

  const [task] = await db.select().from(schema.tasks).where(whereClause);

  if (!task) {
    return {
      valid: false,
      errors: ["Task not found"],
      warnings: [],
    };
  }

  // Check if agent has developer/reviewer role pack
  const agent = assignedAgentId
    ? (await db.select().from(schema.agents).where(eq(schema.agents.id, assignedAgentId)).limit(1))[0]
    : null;

  const rolePack = getRolePack(agent);
  const isCodeDelivery = rolePack === "developer" || rolePack === "reviewer";

  const errors: string[] = [];
  const warnings: string[] = [];

  // For code-delivery roles, PR URL is mandatory before review/done
  if (isCodeDelivery && !task.prUrl) {
    errors.push(
      `Role pack "${rolePack}" requires prUrl before task can move to review or done`
    );
  }

  // Branch/repo consistency
  if (task.prUrl && !task.branch) {
    warnings.push("prUrl is set but branch is missing — may indicate incomplete delivery metadata");
  }
  if (task.prUrl && !task.repo) {
    warnings.push("prUrl is set but repo is missing — may indicate incomplete delivery metadata");
  }

  // Review cycle count sanity check
  if (task.reviewCycleCount > 5) {
    warnings.push(`High review cycle count: ${task.reviewCycleCount} — task may be stuck in review loop`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    task,
  };
}

// ─── Role Pack Inference ────────────────────────────────────────────

function getRolePack(agent: typeof schema.agents.$inferSelect | undefined | null): string | null {
  if (!agent?.runtimeConfig || typeof agent.runtimeConfig !== "object") return null;
  const operatingLayer = (agent.runtimeConfig as Record<string, unknown>).operatingLayer;
  if (!operatingLayer || typeof operatingLayer !== "object") return null;
  const rolePack = (operatingLayer as Record<string, unknown>).rolePack;
  return typeof rolePack === "string" ? rolePack : null;
}

// ─── Supervisor Rejection Handler ───────────────────────────────────

export interface SupervisorRejection {
  rejected: boolean;
  reason: string;
  retrySuggestion?: string;
}

/**
 * Supervisor-side rejection when a handback does not satisfy the schema.
 * Returns rejection details and retry guidance.
 */
export function evaluateSupervisorRejection(
  validationResult: CompletionValidationResult,
  targetStatus: string
): SupervisorRejection {
  if (validationResult.valid) {
    return { rejected: false, reason: "" };
  }

  const errorSummary = validationResult.errors.join("; ");
  
  let retrySuggestion: string | undefined;
  if (validationResult.errors.some(e => e.includes("prUrl"))) {
    retrySuggestion = "Open a PR and link it to the task via prUrl before setting status to review/done";
  } else if (validationResult.errors.some(e => e.includes("branch"))) {
    retrySuggestion = "Ensure the branch name is recorded on the task via PATCH /api/tasks/{id}";
  } else if (validationResult.errors.some(e => e.includes("repo"))) {
    retrySuggestion = "Record the repo URL on the task via PATCH /api/tasks/{id}";
  }

  return {
    rejected: true,
    reason: `Completion rejected by supervisor: ${errorSummary}`,
    retrySuggestion,
  };
}

// ─── Report Format vs Execution Separation ──────────────────────────

/**
 * Distinguishes between:
 * - executionSuccess: Did the agent do the work?
 * - reportValid: Did the agent report it properly?
 * 
 * An agent can succeed at execution but fail at reporting (or vice versa).
 */
export function classifyCompletionOutcome(
  executionSuccess: boolean,
  validationResult: CompletionValidationResult
): {
  outcome: "execution_and_report_ok" | "execution_ok_report_bad" | "execution_bad_report_ok" | "both_failed";
  humanReadable: string;
} {
  const reportValid = validationResult.valid;

  if (executionSuccess && reportValid) {
    return {
      outcome: "execution_and_report_ok",
      humanReadable: "Task completed and reported correctly",
    };
  }
  if (executionSuccess && !reportValid) {
    return {
      outcome: "execution_ok_report_bad",
      humanReadable: `Agent did the work but the completion report is invalid: ${validationResult.errors.join("; ")}`,
    };
  }
  if (!executionSuccess && reportValid) {
    return {
      outcome: "execution_bad_report_ok",
      humanReadable: "Agent reported completion but execution failed — report may be stale or incorrect",
    };
  }
  return {
    outcome: "both_failed",
    humanReadable: `Task failed execution and has an invalid report: ${validationResult.errors.join("; ")}`,
  };
}
