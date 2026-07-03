import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";
import type { RuntimeConnectionRecord, RuntimeDiscoveredModel, RuntimeProvider } from "./types";
import { HermesRuntimeProvider } from "./hermes";

const hermesProvider = new HermesRuntimeProvider();

const openClawProvider: RuntimeProvider = {
  type: "openclaw",
  displayName: "OpenClaw Gateway",
  async discoverModels(runtime: RuntimeConnectionRecord): Promise<RuntimeDiscoveredModel[]> {
    const client = await getGatewayClientForRuntime(runtime.id);
    const result = await client.listModels();
    return (result.models ?? [])
      .map((model) => {
        const id = normalizeString(model.id);
        if (!id) return null;
        return {
          runtimeId: runtime.id,
          provider: normalizeString(model.provider) ?? "unknown",
          id,
          name: normalizeString(model.name) ?? id,
        };
      })
      .filter((model): model is RuntimeDiscoveredModel => model !== null)
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  },
};

export function getRuntimeProvider(runtimeType: string | null | undefined): RuntimeProvider {
  if (runtimeType === "hermes") return hermesProvider;
  return openClawProvider;
}

export type { RuntimeConnectionRecord, RuntimeDiscoveredModel, RuntimeProvider } from "./types";
export { HermesRuntimeProvider, normalizeHermesRootUrl, hermesApiUrl, normalizeHermesModels } from "./hermes";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
