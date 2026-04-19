import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";

export async function syncAgentModelToRuntime(params: {
  runtimeId: string;
  runtimeRef: string;
  primaryModel: string;
  fallbackModels?: string[];
}): Promise<void> {
  if (!db) throw new Error("Database not available");

  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, params.runtimeId)).limit(1)
  );
  if (!runtime) throw new Error(`Runtime ${params.runtimeId} not found`);

  const metadata =
    runtime.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
      ? (runtime.metadata as Record<string, unknown>)
      : null;
  const deviceKeyPem =
    typeof metadata?.devicePrivateKeyPem === "string" ? metadata.devicePrivateKeyPem : undefined;

  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    const snapshot = await client.configGet();
    await client.configPatch({
      patch: {
        agents: {
          list: [
            {
              id: params.runtimeRef,
              model: {
                primary: params.primaryModel,
                fallbacks: params.fallbackModels ?? [],
              },
            },
          ],
        },
      },
      baseHash: snapshot.hash,
      note: `CrewCmd aligned model for ${params.runtimeRef}`,
    });
  } finally {
    client.close();
  }
}
