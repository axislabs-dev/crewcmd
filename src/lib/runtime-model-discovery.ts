import type { GatewayModel } from "@/lib/gateway-client";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRuntimeProvider, type RuntimeDiscoveredModel } from "@/lib/runtimes/providers";

export type { RuntimeDiscoveredModel } from "@/lib/runtimes/providers";

export async function discoverRuntimeModels(runtimeId: string): Promise<RuntimeDiscoveredModel[]> {
  if (!db) throw new Error("Database not available");

  const [runtime] = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(eq(companyRuntimes.id, runtimeId))
      .limit(1)
  );
  if (!runtime) throw new Error(`Runtime not found: ${runtimeId}`);

  const metadata =
    runtime.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
      ? (runtime.metadata as Record<string, unknown>)
      : null;
  const provider = getRuntimeProvider(runtime.runtimeType);

  return provider.discoverModels({
    id: runtime.id,
    runtimeType: runtime.runtimeType,
    name: runtime.name,
    gatewayUrl: runtime.gatewayUrl,
    httpUrl: runtime.httpUrl,
    authToken: runtime.authToken,
    metadata,
  });
}

export function normalizeRuntimeModels(
  runtimeId: string,
  models: GatewayModel[] | null | undefined
): RuntimeDiscoveredModel[] {
  return (models ?? [])
    .map((model) => {
      const id = normalizeString(model.id);
      if (!id) return null;

      return {
        runtimeId,
        provider: normalizeString(model.provider) ?? "unknown",
        id,
        name: normalizeString(model.name) ?? id,
      };
    })
    .filter((model): model is RuntimeDiscoveredModel => model !== null)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
