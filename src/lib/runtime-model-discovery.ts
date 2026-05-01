import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";
import type { GatewayModel } from "@/lib/gateway-client";

export interface RuntimeDiscoveredModel {
  runtimeId: string;
  provider: string;
  id: string;
  name: string;
}

export async function discoverRuntimeModels(runtimeId: string): Promise<RuntimeDiscoveredModel[]> {
  const client = await getGatewayClientForRuntime(runtimeId);
  const result = await client.listModels();

  return normalizeRuntimeModels(runtimeId, result.models);
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
