import { db, withRetry } from "@/db";
import { serviceSecrets } from "@/db/schema";
import { and, eq } from "drizzle-orm";

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

export async function validateSkillConfigSecretRefs(companyId: string | null | undefined, config: unknown) {
  const names = [...collectSecretRefNames(config)];
  if (names.length === 0) return { ok: true as const };

  if (!companyId) {
    return { ok: false as const, error: "Secret references require an agent with a companyId" };
  }

  if (!db) {
    return { ok: false as const, error: "Database not available" };
  }

  for (const name of names) {
    const [secret] = await withRetry(() =>
      db!
        .select({ id: serviceSecrets.id })
        .from(serviceSecrets)
        .where(and(eq(serviceSecrets.companyId, companyId), eq(serviceSecrets.name, name)))
        .limit(1)
    );

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
