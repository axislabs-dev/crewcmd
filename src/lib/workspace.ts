import { and, eq, inArray, or } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db, withRetry } from "@/db";
import {
  agentWorkspaceGrants,
  agents,
  companies,
  companyMembers,
  companyRuntimes,
  workspaces,
  users,
  type companyRoleEnum,
} from "@/db/schema";
import { resolveCurrentUser } from "@/lib/resolve-user";
import { getHeartbeatSecret } from "@/lib/heartbeat-secret";

export type CompanyRole = typeof companyRoleEnum.enumValues[number];
export type WorkspaceType = "personal" | "company";
export type WorkspaceAccessLevel = "viewer" | "operator" | "manager";

export interface WorkspaceAccessContext {
  userId: string | null;
  activeWorkspaceId: string | null;
  activeCompanyId: string | null;
  memberships: Array<{ companyId: string; role: CompanyRole }>;
  isHeartbeatBearer: boolean;
}

export interface WorkspaceRecord {
  id: string;
  type: WorkspaceType;
  name: string;
  ownerUserId: string | null;
  companyId: string | null;
}

export interface WorkspaceSummary extends WorkspaceRecord {
  companyName: string | null;
  companyLogoUrl: string | null;
  companySettings: Record<string, unknown> | null;
  memberRole: CompanyRole | null;
}

interface BearerRuntimeAccess {
  runtime: typeof companyRuntimes.$inferSelect;
  allowedWorkspaceIds: Set<string>;
  defaultWorkspaceId: string | null;
}

export async function isHeartbeatBearerRequest(request?: Request | NextRequest) {
  const authHeader = request?.headers?.get("authorization");
  const expectedToken = await getHeartbeatSecret();
  return !!expectedToken && !!authHeader && authHeader === `Bearer ${expectedToken}`;
}

export async function ensureCompanyWorkspace(companyId: string): Promise<WorkspaceRecord | null> {
  if (!db) return null;

  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.type, "company"), eq(workspaces.companyId, companyId)))
      .limit(1)
  );
  if (existing) return existing;

  const [company] = await withRetry(() =>
    db!
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1)
  );
  if (!company) return null;

  try {
    const [created] = await withRetry(() =>
      db!
        .insert(workspaces)
        .values({
          type: "company",
          name: company.name,
          companyId: company.id,
        })
        .returning()
    );
    return created ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("workspaces_type_company_id_unique")) throw error;
    const [raced] = await withRetry(() =>
      db!
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.type, "company"), eq(workspaces.companyId, companyId)))
        .limit(1)
    );
    return raced ?? null;
  }
}

export async function ensurePersonalWorkspace(userId: string): Promise<WorkspaceRecord | null> {
  if (!db) return null;

  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.type, "personal"), eq(workspaces.ownerUserId, userId)))
      .limit(1)
  );
  if (existing) return existing;

  const [user] = await withRetry(() =>
    db!
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  );
  if (!user) return null;

  try {
    const [created] = await withRetry(() =>
      db!
        .insert(workspaces)
        .values({
          type: "personal",
          name: user.name || user.email || "Personal Workspace",
          ownerUserId: user.id,
        })
        .returning()
    );
    return created ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("workspaces_type_owner_user_id_unique")) throw error;
    const [raced] = await withRetry(() =>
      db!
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.type, "personal"), eq(workspaces.ownerUserId, userId)))
        .limit(1)
    );
    return raced ?? null;
  }
}

export async function getWorkspaceAccessContext(request?: Request | NextRequest): Promise<WorkspaceAccessContext> {
  const user = await resolveCurrentUser(request);
  const cookieStore = await cookies();
  const activeWorkspaceId = cookieStore.get("active_workspace")?.value ?? null;
  const activeCompanyId = cookieStore.get("active_company")?.value ?? null;
  const heartbeat = await isHeartbeatBearerRequest(request);

  if (!db || !user || heartbeat) {
    return {
      userId: user?.id ?? null,
      activeWorkspaceId,
      activeCompanyId,
      memberships: [],
      isHeartbeatBearer: heartbeat,
    };
  }

  const memberships = await withRetry(() =>
    db!
      .select({ companyId: companyMembers.companyId, role: companyMembers.role })
      .from(companyMembers)
      .where(eq(companyMembers.userId, user.id))
  );

  return {
    userId: user.id,
    activeWorkspaceId,
    activeCompanyId,
    memberships,
    isHeartbeatBearer: false,
  };
}

export async function listAccessibleWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  if (!db) return [];

  const [personal, memberships] = await Promise.all([
    ensurePersonalWorkspace(userId),
    withRetry(() =>
      db!
        .select({
          companyId: companyMembers.companyId,
          role: companyMembers.role,
          companyName: companies.name,
          companyLogoUrl: companies.logoUrl,
          companySettings: companies.settings,
        })
        .from(companyMembers)
        .innerJoin(companies, eq(companyMembers.companyId, companies.id))
        .where(eq(companyMembers.userId, userId))
    ),
  ]);

  const companyWorkspaces = await Promise.all(
    memberships.map(async (membership) => {
      const workspace = await ensureCompanyWorkspace(membership.companyId);
      if (!workspace) return null;
      return {
        ...workspace,
        companyName: membership.companyName,
        companyLogoUrl: membership.companyLogoUrl,
        companySettings: membership.companySettings ?? null,
        memberRole: membership.role,
      };
    })
  );

  const result: WorkspaceSummary[] = [];
  if (personal) {
    result.push({
      ...personal,
      companyName: null,
      companyLogoUrl: null,
      companySettings: null,
      memberRole: null,
    });
  }
  for (const workspace of companyWorkspaces) {
    if (workspace) result.push(workspace);
  }
  return result;
}

export async function resolveAccessibleWorkspace(params: {
  request?: Request | NextRequest;
  explicitWorkspaceId?: string | null;
  explicitCompanyId?: string | null;
  requireExplicitForBearer?: boolean;
}): Promise<WorkspaceRecord | null> {
  if (!db) return null;

  const ctx = await getWorkspaceAccessContext(params.request);
  const bearerRuntimeAccess = ctx.isHeartbeatBearer
    ? await resolveBearerRuntimeAccess(params.request)
    : null;

  if (params.explicitWorkspaceId) {
    const [workspace] = await withRetry(() =>
      db!
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, params.explicitWorkspaceId!))
        .limit(1)
    );

    if (!workspace) return null;
    if (ctx.isHeartbeatBearer) {
      return bearerRuntimeAccess?.allowedWorkspaceIds.has(workspace.id) ? workspace : null;
    }
    if (!ctx.userId) return null;

    const allowedCompanyIds = new Set(ctx.memberships.map((membership) => membership.companyId));
    if (workspace.type === "personal") {
      return workspace.ownerUserId === ctx.userId ? workspace : null;
    }
    return workspace.companyId && allowedCompanyIds.has(workspace.companyId) ? workspace : null;
  }

  if (params.explicitCompanyId) {
    if (ctx.isHeartbeatBearer) {
      const companyWorkspace = await ensureCompanyWorkspace(params.explicitCompanyId);
      if (!companyWorkspace) return null;
      return bearerRuntimeAccess?.allowedWorkspaceIds.has(companyWorkspace.id)
        ? companyWorkspace
        : null;
    }
    if (!ctx.isHeartbeatBearer) {
      const allowedCompanyIds = new Set(ctx.memberships.map((membership) => membership.companyId));
      if (!allowedCompanyIds.has(params.explicitCompanyId)) return null;
    }
    return ensureCompanyWorkspace(params.explicitCompanyId);
  }

  if (ctx.isHeartbeatBearer && params.requireExplicitForBearer) {
    return null;
  }

  if (ctx.isHeartbeatBearer) {
    return bearerRuntimeAccess?.defaultWorkspaceId
      ? getWorkspaceById(bearerRuntimeAccess.defaultWorkspaceId)
      : null;
  }

  if (ctx.activeWorkspaceId) {
    return resolveAccessibleWorkspace({
      request: params.request,
      explicitWorkspaceId: ctx.activeWorkspaceId,
    });
  }

  if (ctx.userId) {
    const personal = await ensurePersonalWorkspace(ctx.userId);
    if (personal) return personal;
  }

  if (ctx.activeCompanyId) {
    return ensureCompanyWorkspace(ctx.activeCompanyId);
  }

  if (ctx.memberships.length > 0) {
    return ensureCompanyWorkspace(ctx.memberships[0].companyId);
  }

  return null;
}

export async function getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null> {
  if (!db) return null;
  const [workspace] = await withRetry(() =>
    db!.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  );
  return workspace ?? null;
}

export async function getWorkspaceIdsForUser(userId: string): Promise<string[]> {
  const accessible = await listAccessibleWorkspaces(userId);
  return accessible.map((workspace) => workspace.id);
}

export async function getAccessibleWorkspaceMap(userId: string) {
  const entries = await listAccessibleWorkspaces(userId);
  return new Map(entries.map((workspace) => [workspace.id, workspace] as const));
}

export async function getWorkspaceIdsForCompanies(companyIds: string[]) {
  if (!db || companyIds.length === 0) return [];
  const rows = await withRetry(() =>
    db!
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.type, "company"), inArray(workspaces.companyId, companyIds)))
  );
  return rows.map((row) => row.id);
}

export async function getReadableWorkspaceIdsForSession(request?: Request | NextRequest) {
  const ctx = await getWorkspaceAccessContext(request);
  if (!ctx.userId) return [];
  const workspacesForUser = await listAccessibleWorkspaces(ctx.userId);
  return workspacesForUser.map((workspace) => workspace.id);
}

export async function getReadableWorkspaceIdsForCompany(companyId: string) {
  const workspace = await ensureCompanyWorkspace(companyId);
  return workspace ? [workspace.id] : [];
}

export async function getCompanyIdForWorkspace(workspaceId: string): Promise<string | null> {
  const workspace = await getWorkspaceById(workspaceId);
  return workspace?.companyId ?? null;
}

async function resolveBearerRuntimeAccess(
  request?: Request | NextRequest
): Promise<BearerRuntimeAccess | null> {
  if (!db || !(await isHeartbeatBearerRequest(request))) {
    return null;
  }

  const runtimeId = request?.headers?.get("x-crewcmd-runtime-id")?.trim() ?? null;
  if (!runtimeId) return null;

  const [runtime] = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, runtimeId))
      .limit(1)
  );
  if (!runtime) return null;

  const defaultWorkspace = await resolveRuntimeWorkspace(runtime);
  const allowedWorkspaceIds = new Set<string>();
  if (defaultWorkspace?.id) {
    allowedWorkspaceIds.add(defaultWorkspace.id);
  }

  return {
    runtime,
    allowedWorkspaceIds,
    defaultWorkspaceId: defaultWorkspace?.id ?? null,
  };
}

export async function resolveRuntimeWorkspace(runtime: {
  ownerType: "user" | "company";
  ownerUserId?: string | null;
  ownerCompanyId?: string | null;
  companyId?: string | null;
}): Promise<WorkspaceRecord | null> {
  if (runtime.ownerType === "user") {
    return runtime.ownerUserId ? ensurePersonalWorkspace(runtime.ownerUserId) : null;
  }

  const companyId = runtime.ownerCompanyId ?? runtime.companyId ?? null;
  return companyId ? ensureCompanyWorkspace(companyId) : null;
}

export async function grantAgentToWorkspace(params: {
  agentId: string;
  workspaceId: string;
  accessLevel?: WorkspaceAccessLevel;
  grantedBy?: string | null;
}) {
  if (!db) return null;

  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(agentWorkspaceGrants)
      .where(
        and(
          eq(agentWorkspaceGrants.agentId, params.agentId),
          eq(agentWorkspaceGrants.workspaceId, params.workspaceId)
        )
      )
      .limit(1)
  );

  if (existing) {
    const [updated] = await withRetry(() =>
      db!
        .update(agentWorkspaceGrants)
        .set({
          accessLevel: params.accessLevel ?? existing.accessLevel,
          grantedBy: params.grantedBy ?? existing.grantedBy,
          updatedAt: new Date(),
        })
        .where(eq(agentWorkspaceGrants.id, existing.id))
        .returning()
    );
    return updated ?? existing;
  }

  const [created] = await withRetry(() =>
    db!
      .insert(agentWorkspaceGrants)
      .values({
        agentId: params.agentId,
        workspaceId: params.workspaceId,
        accessLevel: params.accessLevel ?? "operator",
        grantedBy: params.grantedBy ?? null,
      })
      .returning()
  );
  return created ?? null;
}

export async function grantAgentDefaultWorkspace(params: {
  agentId: string;
  ownerType: "user" | "company";
  ownerUserId?: string | null;
  ownerCompanyId?: string | null;
  fallbackCompanyId?: string | null;
  grantedBy?: string | null;
}) {
  const companyWorkspaceId = params.ownerCompanyId ?? params.fallbackCompanyId ?? null;
  const targetWorkspace = params.ownerType === "company"
    ? (companyWorkspaceId ? await ensureCompanyWorkspace(companyWorkspaceId) : null)
    : params.ownerUserId
      ? await ensurePersonalWorkspace(params.ownerUserId)
      : null;

  if (!targetWorkspace) return null;
  return grantAgentToWorkspace({
    agentId: params.agentId,
    workspaceId: targetWorkspace.id,
    accessLevel: params.ownerType === "company" ? "operator" : "manager",
    grantedBy: params.grantedBy ?? null,
  });
}

export async function getAgentWorkspaceIds(agentId: string) {
  if (!db) return [];
  const rows = await withRetry(() =>
    db!
      .select({ workspaceId: agentWorkspaceGrants.workspaceId })
      .from(agentWorkspaceGrants)
      .where(eq(agentWorkspaceGrants.agentId, agentId))
  );
  return rows.map((row) => row.workspaceId);
}

export async function listWorkspaceAgents(workspaceId: string, opts?: { runtimeId?: string | null; includeDetached?: boolean }) {
  if (!db) return [];
  const rows = await withRetry(() =>
    db!
      .select({
        agent: agents,
        grant: agentWorkspaceGrants,
      })
      .from(agentWorkspaceGrants)
      .innerJoin(agents, eq(agentWorkspaceGrants.agentId, agents.id))
      .where(eq(agentWorkspaceGrants.workspaceId, workspaceId))
  );

  return rows
    .map((row) => ({
      ...row.agent,
      grantAccessLevel: row.grant.accessLevel,
    }))
    .filter((agent) => {
      if (!opts?.includeDetached && agent.runtimeRef && !agent.runtimeId) return false;
      if (opts?.runtimeId && agent.runtimeId !== opts.runtimeId) return false;
      return true;
    });
}
