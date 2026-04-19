import { companyRuntimes } from "@/db/schema";
import { db, withRetry } from "@/db";
import { buildRuntimeReadWhere, type AgentAccessContext } from "@/lib/agent-access";
import { GatewayClient, resolveDeviceIdentity } from "@/lib/gateway-client";

const CREWCMD_MANAGEMENT_SKILL_KEY = "crewcmd-management";

interface RuntimeSyncResult {
  runtimeId: string;
  ok: boolean;
  error?: string;
}

export async function syncHeartbeatSecretToAccessibleRuntimes(params: {
  access: AgentAccessContext;
  secret: string;
}): Promise<RuntimeSyncResult[]> {
  if (!db) return [];

  const where = buildRuntimeReadWhere(params.access);
  if (!where) return [];

  const runtimes = await withRetry(() =>
    db!
      .select()
      .from(companyRuntimes)
      .where(where)
  );

  const results: RuntimeSyncResult[] = [];

  for (const runtime of runtimes) {
    const meta = (runtime.metadata || {}) as Record<string, unknown>;
    const deviceKeyPem = typeof meta.devicePrivateKeyPem === "string"
      ? meta.devicePrivateKeyPem
      : undefined;

    const client = new GatewayClient(
      runtime.gatewayUrl,
      runtime.authToken || null,
      resolveDeviceIdentity(deviceKeyPem),
      15000
    );

    try {
      await client.connect();
      await client.configPatch({
        patch: {
          env: {
            HEARTBEAT_SECRET: params.secret,
          },
        },
        note: "CrewCmd rotated HEARTBEAT_SECRET",
      });
      await client.skillsUpdate({
        skillKey: CREWCMD_MANAGEMENT_SKILL_KEY,
        env: {
          HEARTBEAT_SECRET: params.secret,
        },
      });
      await client.secretsReload();
      results.push({ runtimeId: runtime.id, ok: true });
    } catch (error) {
      results.push({
        runtimeId: runtime.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.close();
    }
  }

  return results;
}
