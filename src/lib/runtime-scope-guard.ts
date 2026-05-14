import { db, withRetry } from "@/db";
import { companyRuntimes, workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  assertRuntimeAllowedForScope,
  RUNTIME_CLASSES,
  SCOPE_TYPES,
  type RuntimeBindingTarget,
  type Scope,
} from "@/lib/collaboration-policy";
import { logAudit } from "@/lib/governance";

export type RuntimeScopeContext = {
  companyId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  actor?: string | null;
};

export type RuntimeScopeRuntime = typeof companyRuntimes.$inferSelect;

function runtimeClass(runtime: RuntimeScopeRuntime): RuntimeBindingTarget["class"] {
  return runtime.ownerType === "user" || Boolean(runtime.ownerUserId)
    ? RUNTIME_CLASSES.PERSONAL
    : RUNTIME_CLASSES.SHARED;
}

function runtimeBindingTarget(runtime: RuntimeScopeRuntime): RuntimeBindingTarget {
  return {
    id: runtime.id,
    class: runtimeClass(runtime),
    ownerUserId: runtime.ownerUserId ?? null,
  };
}

async function resolveScope(ctx: RuntimeScopeContext): Promise<Scope | null> {
  if (ctx.companyId) {
    return { id: ctx.companyId, type: SCOPE_TYPES.ORG };
  }

  if (!ctx.workspaceId) return null;

  const workspace = await withRetry(() =>
    db!.query.workspaces.findFirst({
      where: eq(workspaces.id, ctx.workspaceId!),
    })
  );

  if (!workspace) return null;

  if (workspace.type === "company") {
    return { id: workspace.id, type: SCOPE_TYPES.ORG };
  }

  return {
    id: workspace.id,
    type: SCOPE_TYPES.PRIVATE_USER,
    ownerUserId: workspace.ownerUserId ?? undefined,
  };
}

async function auditRuntimeScopeRejection(params: {
  ctx: RuntimeScopeContext;
  runtime: RuntimeScopeRuntime;
  scope: Scope;
  error: Error;
}) {
  const companyId = params.ctx.companyId ?? (params.scope.type === SCOPE_TYPES.ORG ? params.scope.id : null);
  if (!companyId) return;

  try {
    await logAudit(
      companyId,
      params.ctx.actor ?? params.ctx.userId ?? "system",
      "runtime_invocation_rejected",
      "company_runtime",
      params.runtime.id,
      {
        reason: params.error.message,
        runtimeClass: runtimeClass(params.runtime),
        runtimeOwnerUserId: params.runtime.ownerUserId ?? null,
        scopeId: params.scope.id,
        scopeType: params.scope.type,
        workspaceId: params.ctx.workspaceId ?? null,
      },
    );
  } catch (auditError) {
    console.error("[runtime-scope-guard] Failed to audit runtime scope rejection:", auditError);
  }
}

export async function assertRuntimeInvocationAllowedForContext(
  runtime: RuntimeScopeRuntime,
  ctx: RuntimeScopeContext,
): Promise<void> {
  if (!db) return;

  const scope = await resolveScope(ctx);
  if (!scope) return;

  try {
    assertRuntimeAllowedForScope(runtimeBindingTarget(runtime), scope);
  } catch (error) {
    await auditRuntimeScopeRejection({
      ctx,
      runtime,
      scope,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

export async function assertPrimaryRuntimeInvocationAllowedForContext(ctx: RuntimeScopeContext): Promise<void> {
  if (!db) return;

  const runtime = await withRetry(() =>
    db!.query.companyRuntimes.findFirst({
      where: eq(companyRuntimes.isPrimary, true),
    })
  );

  if (!runtime) return;

  await assertRuntimeInvocationAllowedForContext(runtime, ctx);
}
