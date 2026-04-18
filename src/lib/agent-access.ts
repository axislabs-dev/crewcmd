import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agents, companyMembers, companyRuntimes, type companyRoleEnum } from "@/db/schema";
import { cookies } from "next/headers";
import { resolveCurrentUser } from "@/lib/resolve-user";

export type AgentVisibility = "private" | "team" | "org";
export type OwnershipType = "user" | "company";
export type CompanyRole = typeof companyRoleEnum.enumValues[number];

const TEAM_ROLES: CompanyRole[] = ["owner", "admin", "member"];
const COMPANY_ADMIN_ROLES: CompanyRole[] = ["owner", "admin"];

export interface AgentAccessContext {
  userId: string | null;
  activeCompanyId: string | null;
  memberships: Array<{ companyId: string; role: CompanyRole }>;
}

export async function getAgentAccessContext(): Promise<AgentAccessContext> {
  const user = await resolveCurrentUser();
  const cookieStore = await cookies();
  const activeCompanyId = cookieStore.get("active_company")?.value ?? null;

  if (!db || !user) {
    return { userId: user?.id ?? null, activeCompanyId, memberships: [] };
  }

  const memberships = await withRetry(() =>
    db!
      .select({ companyId: companyMembers.companyId, role: companyMembers.role })
      .from(companyMembers)
      .where(eq(companyMembers.userId, user.id))
  );

  return { userId: user.id, activeCompanyId, memberships };
}

export function getCompanyRole(
  ctx: AgentAccessContext,
  companyId: string | null | undefined,
): CompanyRole | null {
  if (!companyId) return null;
  return ctx.memberships.find((membership) => membership.companyId === companyId)?.role ?? null;
}

export function canManageCompanyOwnedAgent(ctx: AgentAccessContext, companyId: string | null | undefined) {
  const role = getCompanyRole(ctx, companyId);
  return !!role && COMPANY_ADMIN_ROLES.includes(role);
}

export function normalizeVisibilityForCreation(params: {
  ownerType: OwnershipType;
  requestedVisibility?: string | null;
}) {
  if (params.ownerType === "user") return "private" satisfies AgentVisibility;

  const requested = params.requestedVisibility;
  if (requested === "team" || requested === "org") return requested;
  return "team" satisfies AgentVisibility;
}

export async function resolveRuntimeOwnership(runtimeId?: string | null) {
  if (!db || !runtimeId) return null;
  const [runtime] = await withRetry(() =>
    db!
      .select({
        id: companyRuntimes.id,
        companyId: companyRuntimes.companyId,
        ownerType: companyRuntimes.ownerType,
        ownerUserId: companyRuntimes.ownerUserId,
        ownerCompanyId: companyRuntimes.ownerCompanyId,
      })
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, runtimeId))
      .limit(1)
  );

  if (!runtime) return null;
  return {
    ownerType: runtime.ownerType,
    ownerUserId: runtime.ownerUserId,
    ownerCompanyId: runtime.ownerCompanyId ?? runtime.companyId,
  };
}

export function canReadAgent(agent: {
  ownerType: OwnershipType;
  ownerUserId: string | null;
  ownerCompanyId: string | null;
  visibility: AgentVisibility;
}, ctx: AgentAccessContext) {
  if (!ctx.userId) return false;
  if (agent.ownerUserId && agent.ownerUserId === ctx.userId) return true;

  const role = getCompanyRole(ctx, agent.ownerCompanyId);
  if (!role) return false;

  if (agent.visibility === "org") return true;
  if (agent.visibility === "team") return TEAM_ROLES.includes(role);
  return COMPANY_ADMIN_ROLES.includes(role) && agent.ownerType === "company";
}

export function canUpdateAgent(agent: {
  ownerType: OwnershipType;
  ownerUserId: string | null;
  ownerCompanyId: string | null;
}, ctx: AgentAccessContext) {
  if (!ctx.userId) return false;
  if (agent.ownerType === "user") return agent.ownerUserId === ctx.userId;
  return canManageCompanyOwnedAgent(ctx, agent.ownerCompanyId);
}

export function buildAgentReadWhere(ctx: AgentAccessContext): SQL<unknown> | undefined {
  const companyIds = ctx.memberships.map((membership) => membership.companyId);
  const teamCompanyIds = ctx.memberships
    .filter((membership) => TEAM_ROLES.includes(membership.role))
    .map((membership) => membership.companyId);
  const adminCompanyIds = ctx.memberships
    .filter((membership) => COMPANY_ADMIN_ROLES.includes(membership.role))
    .map((membership) => membership.companyId);

  const clauses: SQL<unknown>[] = [];

  if (ctx.userId) {
    clauses.push(eq(agents.ownerUserId, ctx.userId));
  }
  if (companyIds.length > 0) {
    clauses.push(and(eq(agents.visibility, "org"), inArray(agents.ownerCompanyId, companyIds))!);
  }
  if (teamCompanyIds.length > 0) {
    clauses.push(and(eq(agents.visibility, "team"), inArray(agents.ownerCompanyId, teamCompanyIds))!);
  }
  if (adminCompanyIds.length > 0) {
    clauses.push(and(eq(agents.visibility, "private"), eq(agents.ownerType, "company"), inArray(agents.ownerCompanyId, adminCompanyIds))!);
  }
  if (clauses.length === 0) return undefined;
  return or(...clauses) ?? undefined;
}

export function buildRuntimeReadWhere(ctx: AgentAccessContext): SQL<unknown> | undefined {
  const companyIds = ctx.memberships.map((membership) => membership.companyId);
  const clauses: SQL<unknown>[] = [];
  if (ctx.userId) clauses.push(eq(companyRuntimes.ownerUserId, ctx.userId));
  if (companyIds.length > 0) clauses.push(inArray(companyRuntimes.ownerCompanyId, companyIds));
  if (clauses.length === 0) return undefined;
  return or(...clauses) ?? undefined;
}

export function runtimeOwnershipValues(params: {
  ownerType?: string | null;
  userId: string | null;
  activeCompanyId?: string | null;
}) {
  const ownerType: OwnershipType = params.ownerType === "company" ? "company" : "user";
  if (ownerType === "company") {
    if (!params.activeCompanyId) {
      throw new Error("Company-owned runtimes require a company workspace");
    }
    return {
      ownerType,
      ownerUserId: null,
      ownerCompanyId: params.activeCompanyId,
      companyId: params.activeCompanyId,
    };
  }
  return {
    ownerType,
    ownerUserId: params.userId,
    ownerCompanyId: null,
    companyId: params.activeCompanyId ?? null,
  };
}
