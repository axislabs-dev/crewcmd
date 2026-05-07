import { and, desc, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyMembers, companyRuntimes, companyRoleEnum } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity, type GatewaySkillStatusEntry } from "@/lib/gateway-client";
import type { MarketplaceSkill } from "@/lib/skill-providers/catalog";
import { normalizeClawhubEntry } from "@/lib/skill-providers/clawhub";
import { getWorkspaceAccessContext, type WorkspaceRecord } from "@/lib/workspace";

export type CompanyRole = typeof companyRoleEnum.enumValues[number];

export async function resolveWorkspaceRuntime(params: {
  runtimeId?: string | null;
  workspace: WorkspaceRecord;
}) {
  if (!db) return null;

  const ownerWhere = params.workspace.type === "personal"
    ? and(
        eq(companyRuntimes.ownerType, "user"),
        eq(companyRuntimes.ownerUserId, params.workspace.ownerUserId ?? "")
      )
    : and(
        eq(companyRuntimes.ownerType, "company"),
        eq(companyRuntimes.ownerCompanyId, params.workspace.companyId ?? "")
      );

  const where = params.runtimeId
    ? and(eq(companyRuntimes.id, params.runtimeId), ownerWhere)
    : ownerWhere;

  const [runtime] = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(where)
      .orderBy(desc(companyRuntimes.isPrimary), desc(companyRuntimes.updatedAt))
      .limit(1)
  );

  return runtime ?? null;
}

export async function withGateway<T>(
  runtime: typeof companyRuntimes.$inferSelect,
  fn: (client: GatewayClient) => Promise<T>
): Promise<T> {
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = typeof meta?.devicePrivateKeyPem === "string" ? meta.devicePrivateKeyPem : undefined;
  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.close();
  }
}

export async function listNativeClawhubSkills(params: {
  runtime: typeof companyRuntimes.$inferSelect;
  query?: string;
  limit?: number;
}): Promise<{ skills: MarketplaceSkill[]; installedSlugs: Set<string> }> {
  return withGateway(params.runtime, async (client) => {
    const [search, status] = await Promise.all([
      client.skillsSearch({ query: params.query, limit: params.limit }),
      client.skillsStatus({}).catch(() => ({ skills: [] as GatewaySkillStatusEntry[] })),
    ]);

    const installedSlugs = new Set(
      (status.skills || []).map((skill) => skill.skillKey || skill.name).filter(Boolean)
    );
    const entries = extractSearchEntries(search);
    const skills = entries
      .map((entry) => normalizeNativeMarketplaceSkill(entry, installedSlugs))
      .filter((skill): skill is MarketplaceSkill => Boolean(skill));

    return { skills, installedSlugs };
  });
}

export function normalizeNativeMarketplaceSkill(entry: Record<string, unknown>, installedSlugs = new Set<string>()): MarketplaceSkill | null {
  const skill = normalizeClawhubEntry(entry);
  if (!skill) return null;
  const installed = installedSlugs.has(skill.slug);
  const metadata = {
    ...(skill.metadata || {}),
    provider: {
      ...((skill.metadata?.provider && typeof skill.metadata.provider === "object") ? skill.metadata.provider as Record<string, unknown> : {}),
      id: "clawhub",
      skillId: skill.slug,
      version: skill.version,
    },
    native: {
      runtime: "openclaw",
      installStatus: installed ? "installed" : "available",
    },
    update: {
      ...((skill.metadata?.update && typeof skill.metadata.update === "object") ? skill.metadata.update as Record<string, unknown> : {}),
      status: installed ? "current" : "not-installed",
      currentVersion: installed ? skill.version : undefined,
    },
  };
  return { ...skill, metadata };
}

export function extractSearchEntries(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  for (const key of ["skills", "items", "results", "data"]) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry));
    }
  }
  return [];
}

export async function canInstallNativeSkill(request: Request, workspace: WorkspaceRecord): Promise<boolean> {
  const ctx = await getWorkspaceAccessContext(request);
  if (!ctx.userId) return false;
  if (workspace.type === "personal") {
    return workspace.ownerUserId === ctx.userId;
  }
  if (!workspace.companyId) return false;
  const membership = ctx.memberships.find((item) => item.companyId === workspace.companyId);
  return membership?.role === "owner" || membership?.role === "admin";
}

export async function loadCompanyMembershipRole(userId: string | null, companyId: string | null): Promise<CompanyRole | null> {
  if (!db || !userId || !companyId) return null;
  const [membership] = await withRetry(() =>
    db!
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)))
      .limit(1)
  );
  return membership?.role ?? null;
}
