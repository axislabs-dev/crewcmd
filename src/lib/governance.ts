import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalGates,
  approvalRequests,
  configVersions,
  auditLog,
} from "@/db/schema";

type GateType =
  | "agent_hire"
  | "strategy_change"
  | "budget_increase"
  | "config_change"
  | "task_escalation";

/**
 * Check if an approval gate exists for a given company and gate type.
 * Returns the gate config or null if no gate is configured.
 */
export async function checkApprovalRequired(
  companyId: string,
  gateType: GateType
) {
  if (!db) return null;

  const [gate] = await db
    .select()
    .from(approvalGates)
    .where(
      and(
        eq(approvalGates.companyId, companyId),
        eq(approvalGates.gateType, gateType)
      )
    )
    .limit(1);

  return gate ?? null;
}

/**
 * Create an approval request that auto-matches to the configured gate.
 */
export async function requestApproval(
  companyId: string,
  gateType: GateType,
  requestedBy: string,
  payload: Record<string, unknown>
) {
  if (!db) return null;

  const gate = await checkApprovalRequired(companyId, gateType);
  if (!gate) return null;

  const [request] = await db
    .insert(approvalRequests)
    .values({
      gateId: gate.id,
      companyId,
      requestedBy,
      requestType: gateType,
      payload,
      status: "pending",
    })
    .returning();

  await logAudit(companyId, requestedBy, "created", "approval_request", request.id, {
    gateType,
    payload,
  });

  return request;
}

/**
 * Approve or reject an approval request.
 */
export async function processApproval(
  requestId: string,
  decidedBy: string,
  approved: boolean,
  reason?: string
) {
  if (!db) return null;

  const [request] = await db
    .update(approvalRequests)
    .set({
      status: approved ? "approved" : "rejected",
      decidedBy,
      decidedAt: new Date(),
      reason: reason ?? null,
    })
    .where(eq(approvalRequests.id, requestId))
    .returning();

  if (request) {
    await logAudit(
      request.companyId,
      decidedBy,
      approved ? "approved" : "rejected",
      "approval_request",
      request.id,
      { requestType: request.requestType, reason }
    );
  }

  return request ?? null;
}

/**
 * Append an entry to the immutable audit log.
 */
export async function logAudit(
  companyId: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  if (!db) return null;

  const [entry] = await db
    .insert(auditLog)
    .values({
      companyId,
      actor,
      action,
      entityType,
      entityId,
      details: details ?? null,
    })
    .returning();

  return entry;
}

/**
 * Save a versioned snapshot of an entity's config.
 * Auto-increments the version number per entity.
 */
export async function saveConfigVersion(
  companyId: string,
  entityType: string,
  entityId: string,
  snapshot: Record<string, unknown>,
  changedBy: string,
  description?: string
) {
  if (!db) return null;

  // Get the latest version number for this entity
  const [latest] = await db
    .select({ version: configVersions.version })
    .from(configVersions)
    .where(
      and(
        eq(configVersions.companyId, companyId),
        eq(configVersions.entityType, entityType),
        eq(configVersions.entityId, entityId)
      )
    )
    .orderBy(desc(configVersions.version))
    .limit(1);

  const nextVersion = (latest?.version ?? 0) + 1;

  const [version] = await db
    .insert(configVersions)
    .values({
      companyId,
      entityType,
      entityId,
      version: nextVersion,
      configSnapshot: snapshot,
      changedBy,
      changeDescription: description ?? null,
    })
    .returning();

  await logAudit(companyId, changedBy, "created", "config_version", version.id, {
    entityType,
    entityId,
    version: nextVersion,
    description,
  });

  return version;
}

/**
 * Rollback to a specific config version.
 * Creates a new version with the old snapshot and logs the rollback.
 */
export async function rollbackConfig(
  versionId: string,
  rolledBackBy: string
) {
  if (!db) return null;

  // Get the version to rollback to
  const [targetVersion] = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.id, versionId))
    .limit(1);

  if (!targetVersion) return null;

  // Create a new version with the old snapshot
  const newVersion = await saveConfigVersion(
    targetVersion.companyId,
    targetVersion.entityType,
    targetVersion.entityId,
    targetVersion.configSnapshot,
    rolledBackBy,
    `Rollback to version ${targetVersion.version}`
  );

  await logAudit(
    targetVersion.companyId,
    rolledBackBy,
    "rolled_back",
    "config_version",
    versionId,
    {
      entityType: targetVersion.entityType,
      entityId: targetVersion.entityId,
      fromVersion: targetVersion.version,
      newVersionId: newVersion?.id,
    }
  );

  return newVersion;
}
