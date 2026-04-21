import { db, withRetry } from "@/db";
import { serviceSecrets, workspaces } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";

export interface SecretRefValue {
  secretRef: {
    name: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function collectSecretRefNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSecretRefNames(item, names);
    return names;
  }

  if (!isObject(value)) return names;

  if (isSecretRefValue(value)) {
    names.add(value.secretRef.name.trim());
    return names;
  }

  for (const child of Object.values(value)) {
    collectSecretRefNames(child, names);
  }

  return names;
}

export function isSecretRefValue(value: unknown): value is SecretRefValue {
  if (!isObject(value)) return false;
  const secretRef = value.secretRef;
  return isObject(secretRef) && typeof secretRef.name === "string" && secretRef.name.trim().length > 0;
}

async function resolveSecretScope(scope: { workspaceId?: string | null; companyId?: string | null | undefined }) {
  const workspaceId = scope.workspaceId ?? null;
  const companyId = scope.companyId ?? null;

  if (!db) {
    return { workspaceId: null, companyId };
  }

  if (workspaceId) {
    const [workspace] = await withRetry(() =>
      db!
        .select({ id: workspaces.id, companyId: workspaces.companyId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
    );

    if (workspace) {
      return { workspaceId: workspace.id, companyId: workspace.companyId ?? null };
    }

    return { workspaceId, companyId };
  }

  return { workspaceId: null, companyId };
}

export async function resolveSecretRef(scope: { workspaceId?: string | null; companyId?: string | null | undefined }, secretRef: unknown): Promise<string | null> {
  if (!db) {
    return null;
  }

  const normalized = isSecretRefValue(secretRef)
    ? secretRef.secretRef.name.trim()
    : isObject(secretRef) && typeof secretRef.name === "string" && secretRef.name.trim().length > 0
      ? secretRef.name.trim()
      : null;

  if (!normalized) {
    return null;
  }

  const resolved = await resolveSecretScope(scope);
  if (!resolved.workspaceId && !resolved.companyId) {
    return null;
  }

  const [secret] = await withRetry(() =>
    db!
      .select({ value: serviceSecrets.value })
      .from(serviceSecrets)
      .where(and(
        eq(serviceSecrets.name, normalized),
        resolved.workspaceId ? eq(serviceSecrets.workspaceId, resolved.workspaceId) : isNull(serviceSecrets.workspaceId),
        resolved.companyId ? eq(serviceSecrets.companyId, resolved.companyId) : isNull(serviceSecrets.companyId),
      ))
      .limit(1)
  );

  return secret?.value ?? null;
}

export async function validateSkillConfigSecretRefs(scope: { workspaceId?: string | null; companyId?: string | null | undefined }, config: unknown) {
  const names = [...collectSecretRefNames(config)];
  if (names.length === 0) return { ok: true as const };

  const resolved = await resolveSecretScope(scope);
  if (!resolved.workspaceId && !resolved.companyId) {
    return { ok: false as const, error: "Secret references require an agent workspace or company scope" };
  }

  if (!db) {
    return { ok: false as const, error: "Database not available" };
  }

  for (const name of names) {
    const secret = await resolveSecretRef(resolved, { secretRef: { name } });

    if (!secret) {
      return { ok: false as const, error: `Unknown secretRef: ${name}` };
    }
  }

  return { ok: true as const };
}

export function toSecretMetadata(secret: {
  id: string;
  name: string;
  description: string | null;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: secret.id,
    name: secret.name,
    description: secret.description,
    maskedValue: secret.value.length > 4 ? "****" + secret.value.slice(-4) : "****",
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt.toISOString(),
  };
}
