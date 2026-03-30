import { eq, and, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  escalationPaths,
  tasks,
  agentHeartbeats,
  approvalGates,
  approvalRequests,
} from "@/db/schema";
import { logAudit } from "@/lib/governance";

type EscalationTrigger =
  | "blocked_task"
  | "budget_exceeded"
  | "heartbeat_failed"
  | "approval_timeout"
  | "agent_offline";

/**
 * Find the matching escalation path for a given trigger.
 * Matches by company, trigger type, and optionally source agent.
 */
export async function getEscalationPath(
  companyId: string,
  triggerType: EscalationTrigger,
  sourceAgentId?: string
) {
  if (!db) return null;

  // Try agent-specific path first
  if (sourceAgentId) {
    const [specific] = await db
      .select()
      .from(escalationPaths)
      .where(
        and(
          eq(escalationPaths.companyId, companyId),
          eq(escalationPaths.triggerType, triggerType),
          eq(escalationPaths.sourceAgentId, sourceAgentId)
        )
      )
      .limit(1);

    if (specific) return specific;
  }

  // Fall back to company-wide path (no specific source agent)
  const paths = await db
    .select()
    .from(escalationPaths)
    .where(
      and(
        eq(escalationPaths.companyId, companyId),
        eq(escalationPaths.triggerType, triggerType)
      )
    );

  // Prefer path with null sourceAgentId (generic) if no specific match
  const generic = paths.find((p) => !p.sourceAgentId);
  return generic ?? paths[0] ?? null;
}

/**
 * Trigger an escalation — creates an approval request or logs the escalation.
 */
export async function triggerEscalation(
  companyId: string,
  triggerType: EscalationTrigger,
  sourceAgentId: string,
  context: Record<string, unknown>
) {
  if (!db) return null;

  const path = await getEscalationPath(companyId, triggerType, sourceAgentId);
  if (!path) {
    // No escalation path configured — just log it
    await logAudit(companyId, "system", "escalation_no_path", "escalation", triggerType, {
      sourceAgentId,
      context,
    });
    return null;
  }

  // Find or create a task_escalation gate for this company
  let [gate] = await db
    .select()
    .from(approvalGates)
    .where(
      and(
        eq(approvalGates.companyId, companyId),
        eq(approvalGates.gateType, "task_escalation")
      )
    )
    .limit(1);

  if (!gate) {
    [gate] = await db
      .insert(approvalGates)
      .values({
        companyId,
        gateType: "task_escalation",
        requiresHuman: !!path.escalateToUserId,
        approverAgentId: path.escalateToAgentId,
        approverUserId: path.escalateToUserId,
      })
      .returning();
  }

  // Create an approval request representing the escalation
  const [request] = await db
    .insert(approvalRequests)
    .values({
      gateId: gate.id,
      companyId,
      requestedBy: sourceAgentId,
      requestType: `escalation:${triggerType}`,
      payload: {
        triggerType,
        sourceAgentId,
        escalateToAgentId: path.escalateToAgentId,
        escalateToUserId: path.escalateToUserId,
        ...context,
      },
      status: "pending",
    })
    .returning();

  await logAudit(companyId, "system", "escalation_triggered", "escalation", request.id, {
    triggerType,
    sourceAgentId,
    escalateToAgentId: path.escalateToAgentId,
    escalateToUserId: path.escalateToUserId,
    context,
  });

  return request;
}

/**
 * Check for tasks that have been blocked longer than configured timeout and trigger escalation.
 */
export async function checkBlockedTasks(companyId: string) {
  if (!db) return [];

  // Get escalation paths for blocked_task trigger
  const paths = await db
    .select()
    .from(escalationPaths)
    .where(
      and(
        eq(escalationPaths.companyId, companyId),
        eq(escalationPaths.triggerType, "blocked_task")
      )
    );

  if (paths.length === 0) return [];

  // Use the shortest timeout configured
  const minTimeout = Math.min(...paths.map((p) => p.timeoutMinutes));
  const cutoff = new Date(Date.now() - minTimeout * 60 * 1000);

  // Find tasks that are blocked and were updated before the cutoff
  const blockedTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, companyId),
        eq(tasks.status, "blocked"),
        lte(tasks.updatedAt, cutoff)
      )
    );

  const escalations = [];
  for (const task of blockedTasks) {
    const result = await triggerEscalation(
      companyId,
      "blocked_task",
      task.assignedAgentId ?? "unassigned",
      { taskId: task.id, taskTitle: task.title, blockedSince: task.updatedAt.toISOString() }
    );
    if (result) escalations.push(result);
  }

  return escalations;
}

/**
 * Check for agents that haven't sent a heartbeat within the configured timeout.
 */
export async function checkOfflineAgents(companyId: string) {
  if (!db) return [];

  const paths = await db
    .select()
    .from(escalationPaths)
    .where(
      and(
        eq(escalationPaths.companyId, companyId),
        eq(escalationPaths.triggerType, "agent_offline")
      )
    );

  if (paths.length === 0) return [];

  const minTimeout = Math.min(...paths.map((p) => p.timeoutMinutes));
  const cutoff = new Date(Date.now() - minTimeout * 60 * 1000);

  // Find agents with stale heartbeats
  const staleAgents = await db
    .select()
    .from(agentHeartbeats)
    .where(lte(agentHeartbeats.lastActive, cutoff));

  const escalations = [];
  for (const agent of staleAgents) {
    const result = await triggerEscalation(
      companyId,
      "agent_offline",
      agent.agentId,
      { callsign: agent.callsign, lastActive: agent.lastActive.toISOString() }
    );
    if (result) escalations.push(result);
  }

  return escalations;
}
