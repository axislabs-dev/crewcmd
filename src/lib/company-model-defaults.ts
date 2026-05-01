import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyModelDefaults, modelProfiles } from "@/db/schema";
import { canManageCompanyOwnedAgent, getAgentAccessContext, getCompanyRole } from "@/lib/agent-access";

export type CompanyModelDefaultRecord = typeof companyModelDefaults.$inferSelect;

export interface CompanyModelDefaultPayload {
  modelProfileId?: unknown;
  model?: unknown;
}

export function serializeCompanyModelDefault(defaultRecord: CompanyModelDefaultRecord | null) {
  if (!defaultRecord) return null;
  return {
    id: defaultRecord.id,
    companyId: defaultRecord.companyId,
    modelProfileId: defaultRecord.modelProfileId,
    model: defaultRecord.model,
    createdAt: defaultRecord.createdAt,
    updatedAt: defaultRecord.updatedAt,
  };
}

export async function canReadCompanyModelDefault(companyId: string): Promise<boolean> {
  const access = await getAgentAccessContext();
  return Boolean(getCompanyRole(access, companyId));
}

export async function canWriteCompanyModelDefault(companyId: string): Promise<boolean> {
  const access = await getAgentAccessContext();
  return canManageCompanyOwnedAgent(access, companyId);
}

export async function getCompanyModelDefault(companyId: string): Promise<CompanyModelDefaultRecord | null> {
  if (!db) return null;

  const [defaultRecord] = await withRetry(() =>
    db!
      .select()
      .from(companyModelDefaults)
      .where(eq(companyModelDefaults.companyId, companyId))
      .limit(1)
  );
  return defaultRecord ?? null;
}

export async function setCompanyModelDefault(
  companyId: string,
  payload: CompanyModelDefaultPayload
): Promise<CompanyModelDefaultRecord | null> {
  if (!db) return null;

  const modelProfileId = readOptionalString(payload.modelProfileId);
  const model = readOptionalString(payload.model);
  if (Boolean(modelProfileId) === Boolean(model)) {
    throw new Error("default_choice_required");
  }

  if (modelProfileId) {
    const [profile] = await withRetry(() =>
      db!
        .select({ id: modelProfiles.id })
        .from(modelProfiles)
        .where(
          and(
            eq(modelProfiles.id, modelProfileId),
            eq(modelProfiles.ownerType, "company"),
            eq(modelProfiles.ownerCompanyId, companyId)
          )
        )
        .limit(1)
    );
    if (!profile) throw new Error("model_profile_not_found");
  }

  const existing = await getCompanyModelDefault(companyId);
  if (existing) {
    const [updated] = await withRetry(() =>
      db!
        .update(companyModelDefaults)
        .set({
          modelProfileId,
          model,
          updatedAt: new Date(),
        })
        .where(eq(companyModelDefaults.companyId, companyId))
        .returning()
    );
    return updated ?? null;
  }

  const [created] = await withRetry(() =>
    db!
      .insert(companyModelDefaults)
      .values({
        companyId,
        modelProfileId,
        model,
      })
      .returning()
  );
  return created ?? null;
}

export async function deleteCompanyModelDefault(companyId: string): Promise<boolean> {
  if (!db) return false;
  const deleted = await withRetry(() =>
    db!
      .delete(companyModelDefaults)
      .where(eq(companyModelDefaults.companyId, companyId))
      .returning({ id: companyModelDefaults.id })
  );
  return deleted.length > 0;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
