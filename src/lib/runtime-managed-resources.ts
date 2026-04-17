import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { runtimeManagedResources } from "@/db/schema";

export type RuntimeManagedResourceType =
  | "cron-job"
  | "skill-entry"
  | "agent-skill"
  | "config-path"
  | "workspace-file";

export interface UpsertRuntimeManagedResourceInput {
  runtimeId: string;
  companyId: string;
  resourceType: RuntimeManagedResourceType;
  resourceKey: string;
  targetAgentId?: string | null;
  targetAgentRef?: string | null;
  externalId?: string | null;
  path?: string | null;
  payload?: Record<string, unknown> | null;
  previousState?: Record<string, unknown> | null;
}

export async function upsertRuntimeManagedResource(
  input: UpsertRuntimeManagedResourceInput
): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  const existing = await withRetry(() =>
    db!
      .select({ id: runtimeManagedResources.id })
      .from(runtimeManagedResources)
      .where(
        and(
          eq(runtimeManagedResources.runtimeId, input.runtimeId),
          eq(runtimeManagedResources.resourceType, input.resourceType),
          eq(runtimeManagedResources.resourceKey, input.resourceKey)
        )
      )
      .limit(1)
  );

  const values = {
    runtimeId: input.runtimeId,
    companyId: input.companyId,
    resourceType: input.resourceType,
    resourceKey: input.resourceKey,
    targetAgentId: input.targetAgentId ?? null,
    targetAgentRef: input.targetAgentRef ?? null,
    externalId: input.externalId ?? null,
    path: input.path ?? null,
    payload: input.payload ?? null,
    previousState: input.previousState ?? null,
    managedBy: "crewcmd",
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await withRetry(() =>
      db!
        .update(runtimeManagedResources)
        .set(values)
        .where(eq(runtimeManagedResources.id, existing[0].id))
    );
    return;
  }

  await withRetry(() =>
    db!.insert(runtimeManagedResources).values(values)
  );
}

export async function listRuntimeManagedResources(runtimeId: string) {
  if (!db) throw new Error("Database not initialized");
  return withRetry(() =>
    db!
      .select()
      .from(runtimeManagedResources)
      .where(eq(runtimeManagedResources.runtimeId, runtimeId))
  );
}

export async function deleteRuntimeManagedResources(runtimeId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized");
  await withRetry(() =>
    db!
      .delete(runtimeManagedResources)
      .where(eq(runtimeManagedResources.runtimeId, runtimeId))
  );
}
