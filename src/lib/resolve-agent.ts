import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveModelDefault, type ModelDefaultSource } from "@/lib/model-default-resolution";
import { resolveRuntimeAgentAdapterConfig } from "@/lib/runtime-agent-credentials";
import { resolveRuntimeAuthTokenForUse } from "@/lib/runtime-token-crypto";

/** Agent record from the database with the fields needed by the runtime */
export interface AgentRecord {
  id: string;
  callsign: string;
  name: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  model: string | null;
  effectiveModel: string | null;
  modelDefaultSource: ModelDefaultSource;
  workspacePath: string | null;
  status: string;
}

/**
 * Resolve an agent from the database by callsign (case-insensitive).
 * Returns null if the agent is not found or the database is unavailable.
 */
export async function resolveAgent(callsign: string): Promise<AgentRecord | null> {
  if (!db) return null;

  try {
    const agents = await withRetry(() => db!.select().from(schema.agents));
    const agent = agents.find(
      (a) => a.callsign.toLowerCase() === callsign.toLowerCase()
    );

    if (!agent) return null;
    const companyDefault = await resolveCompanyDefaultModel(agent.companyId ?? agent.ownerCompanyId);
    const runtimeContext = await resolveRuntimeContext(agent.runtimeId);
    const modelDefault = resolveModelDefault({
      agentOverride: agent.model,
      companyDefault,
      runtimeDefault: runtimeContext?.defaultModel ?? null,
    });
    const storedAdapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;

    return {
      id: agent.id,
      callsign: agent.callsign,
      name: agent.name,
      adapterType: agent.adapterType,
      adapterConfig: agent.runtimeId
        ? resolveRuntimeAgentAdapterConfig(storedAdapterConfig, runtimeContext?.authToken ?? null)
        : storedAdapterConfig,
      runtimeConfig: (agent.runtimeConfig ?? {}) as Record<string, unknown>,
      model: agent.model,
      effectiveModel: modelDefault.model,
      modelDefaultSource: modelDefault.source,
      workspacePath: agent.workspacePath,
      status: agent.status ?? "offline",
    };
  } catch {
    return null;
  }
}

async function resolveCompanyDefaultModel(companyId: string | null): Promise<string | null> {
  if (!db || !companyId) return null;

  const [defaultRecord] = await withRetry(() =>
    db!
      .select()
      .from(schema.companyModelDefaults)
      .where(eq(schema.companyModelDefaults.companyId, companyId))
      .limit(1)
  );
  if (!defaultRecord) return null;
  if (defaultRecord.model) return defaultRecord.model;
  if (!defaultRecord.modelProfileId) return null;
  const modelProfileId = defaultRecord.modelProfileId;

  const [profile] = await withRetry(() =>
    db!
      .select({ primaryModel: schema.modelProfiles.primaryModel })
      .from(schema.modelProfiles)
      .where(eq(schema.modelProfiles.id, modelProfileId))
      .limit(1)
  );
  return profile?.primaryModel ?? null;
}

interface RuntimeContext {
  authToken: string | null;
  defaultModel: string | null;
}

async function resolveRuntimeContext(runtimeId: string | null): Promise<RuntimeContext | null> {
  if (!db || !runtimeId) return null;

  const [runtime] = await withRetry(() =>
    db!
      .select({
        authToken: schema.companyRuntimes.authToken,
        metadata: schema.companyRuntimes.metadata,
      })
      .from(schema.companyRuntimes)
      .where(eq(schema.companyRuntimes.id, runtimeId))
      .limit(1)
  );
  if (!runtime) return null;
  const metadata =
    runtime?.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
      ? (runtime.metadata as Record<string, unknown>)
      : null;
  const snapshot =
    metadata?.capabilitySnapshot && typeof metadata.capabilitySnapshot === "object" && !Array.isArray(metadata.capabilitySnapshot)
      ? (metadata.capabilitySnapshot as Record<string, unknown>)
      : null;
  return {
    authToken: resolveRuntimeAuthTokenForUse(runtime.authToken),
    defaultModel: typeof snapshot?.defaultModel === "string" ? snapshot.defaultModel : null,
  };
}
