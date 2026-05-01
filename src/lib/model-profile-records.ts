import { and, eq, inArray, or } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { modelProfiles } from "@/db/schema";
import { normalizeModelProfile } from "@/lib/model-profiles";
import { getWorkspaceAccessContext, resolveAccessibleWorkspace } from "@/lib/workspace";
import type { NextRequest } from "next/server";

export type ModelProfileRecord = typeof modelProfiles.$inferSelect;

export interface ModelProfilePayload {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  profileKey?: unknown;
  providerPreferences?: unknown;
  primaryModel?: unknown;
  fallbackModels?: unknown;
  companyId?: unknown;
  workspaceId?: unknown;
}

export function serializeModelProfile(profile: ModelProfileRecord) {
  return {
    id: profile.id,
    ownerType: profile.ownerType,
    ownerUserId: profile.ownerUserId,
    ownerCompanyId: profile.ownerCompanyId,
    name: profile.name,
    slug: profile.slug,
    description: profile.description,
    profileKey: profile.profileKey,
    providerPreferences: profile.providerPreferences ?? [],
    primaryModel: profile.primaryModel,
    fallbackModels: profile.fallbackModels ?? [],
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function listAccessibleModelProfiles(request: NextRequest): Promise<ModelProfileRecord[]> {
  if (!db) return [];

  const access = await getWorkspaceAccessContext(request);
  if (!access.userId) return [];

  const companyIds = access.memberships.map((membership) => membership.companyId);
  const filters = [
    and(eq(modelProfiles.ownerType, "user"), eq(modelProfiles.ownerUserId, access.userId)),
  ];

  if (companyIds.length > 0) {
    filters.push(and(eq(modelProfiles.ownerType, "company"), inArray(modelProfiles.ownerCompanyId, companyIds)));
  }

  return withRetry(() =>
    db!
      .select()
      .from(modelProfiles)
      .where(or(...filters))
  );
}

export async function getAccessibleModelProfile(
  request: NextRequest,
  id: string
): Promise<ModelProfileRecord | null> {
  const profiles = await listAccessibleModelProfiles(request);
  return profiles.find((profile) => profile.id === id) ?? null;
}

export async function createModelProfile(request: NextRequest, payload: ModelProfilePayload) {
  if (!db) return null;

  const workspace = await resolveAccessibleWorkspace({
    request,
    explicitWorkspaceId: readOptionalString(payload.workspaceId),
    explicitCompanyId: readOptionalString(payload.companyId),
  });
  if (!workspace) {
    throw new Error("workspace_required");
  }

  const name = readRequiredString(payload.name, "name");
  const slug = readRequiredString(normalizeSlug(readOptionalString(payload.slug) ?? name), "slug");
  const providerPreferences = readStringArray(payload.providerPreferences);
  const fallbackModels = readStringArray(payload.fallbackModels);
  const profileKey = normalizeModelProfile(readOptionalString(payload.profileKey)) ?? null;
  const ownerUserId = workspace.type === "personal" ? workspace.ownerUserId : null;
  const ownerCompanyId = workspace.type === "company" ? workspace.companyId : null;

  if (workspace.type === "personal" && !ownerUserId) throw new Error("owner_required");
  if (workspace.type === "company" && !ownerCompanyId) throw new Error("owner_required");

  const [created] = await withRetry(() =>
    db!
      .insert(modelProfiles)
      .values({
        ownerType: workspace.type === "company" ? "company" : "user",
        ownerUserId,
        ownerCompanyId,
        name,
        slug,
        description: readOptionalString(payload.description),
        profileKey,
        providerPreferences,
        primaryModel: readOptionalString(payload.primaryModel),
        fallbackModels,
      })
      .returning()
  );

  return created;
}

export async function updateModelProfile(
  id: string,
  payload: ModelProfilePayload
): Promise<ModelProfileRecord | null> {
  if (!db) return null;

  const updates: Partial<typeof modelProfiles.$inferInsert> = { updatedAt: new Date() };
  if (payload.name !== undefined) updates.name = readRequiredString(payload.name, "name");
  if (payload.slug !== undefined) {
    updates.slug = readRequiredString(normalizeSlug(readRequiredString(payload.slug, "slug")), "slug");
  }
  if (payload.description !== undefined) updates.description = readOptionalString(payload.description);
  if (payload.profileKey !== undefined) {
    updates.profileKey = normalizeModelProfile(readOptionalString(payload.profileKey)) ?? null;
  }
  if (payload.providerPreferences !== undefined) {
    updates.providerPreferences = readStringArray(payload.providerPreferences);
  }
  if (payload.primaryModel !== undefined) updates.primaryModel = readOptionalString(payload.primaryModel);
  if (payload.fallbackModels !== undefined) updates.fallbackModels = readStringArray(payload.fallbackModels);

  const [updated] = await withRetry(() =>
    db!
      .update(modelProfiles)
      .set(updates)
      .where(eq(modelProfiles.id, id))
      .returning()
  );
  return updated ?? null;
}

export async function deleteModelProfile(id: string): Promise<boolean> {
  if (!db) return false;
  const deleted = await withRetry(() =>
    db!
      .delete(modelProfiles)
      .where(eq(modelProfiles.id, id))
      .returning({ id: modelProfiles.id })
  );
  return deleted.length > 0;
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
