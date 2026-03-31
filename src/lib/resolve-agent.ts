import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";

/** Agent record from the database with the fields needed by the runtime */
export interface AgentRecord {
  id: string;
  callsign: string;
  name: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  model: string | null;
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

    return {
      id: agent.id,
      callsign: agent.callsign,
      name: agent.name,
      adapterType: agent.adapterType,
      adapterConfig: (agent.adapterConfig ?? {}) as Record<string, unknown>,
      runtimeConfig: (agent.runtimeConfig ?? {}) as Record<string, unknown>,
      model: agent.model,
      workspacePath: agent.workspacePath,
      status: agent.status ?? "offline",
    };
  } catch {
    return null;
  }
}
