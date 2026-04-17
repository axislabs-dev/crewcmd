import { companyRuntimes } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";

type RuntimeRecord = typeof companyRuntimes.$inferSelect;

export async function addSkillToGatewayAgentAllowlist(params: {
  runtime: RuntimeRecord;
  agentId: string;
  slug: string;
}): Promise<{ changed: boolean }> {
  return patchGatewayAgentSkillAllowlist({
    runtime: params.runtime,
    agentId: params.agentId,
    slug: params.slug,
    mode: "add",
  });
}

export async function removeSkillFromGatewayAgentAllowlist(params: {
  runtime: RuntimeRecord;
  agentId: string;
  slug: string;
}): Promise<{ changed: boolean }> {
  return patchGatewayAgentSkillAllowlist({
    runtime: params.runtime,
    agentId: params.agentId,
    slug: params.slug,
    mode: "remove",
  });
}

async function patchGatewayAgentSkillAllowlist(params: {
  runtime: RuntimeRecord;
  agentId: string;
  slug: string;
  mode: "add" | "remove";
}): Promise<{ changed: boolean }> {
  const meta = params.runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const client = new GatewayClient(
    params.runtime.gatewayUrl,
    params.runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    const snapshot = await client.configGet();
    const nextSkills = resolveNextSkills(snapshot.config, params.agentId, params.slug, params.mode);
    if (!nextSkills) {
      throw new Error(`Agent ${params.agentId} not found in gateway config`);
    }

    const currentSkills = readCurrentSkills(snapshot.config, params.agentId);
    if (sameSkills(currentSkills, nextSkills)) {
      return { changed: false };
    }

    await client.configPatch({
      patch: {
        agents: {
          list: [
            {
              id: params.agentId,
              skills: nextSkills,
            },
          ],
        },
      },
      baseHash: snapshot.hash,
      note:
        params.mode === "add"
          ? `CrewCMD assigned ${params.slug} to ${params.agentId}`
          : `CrewCMD removed ${params.slug} from ${params.agentId}`,
    });

    return { changed: true };
  } finally {
    client.close();
  }
}

function resolveNextSkills(
  config: Record<string, unknown>,
  agentId: string,
  slug: string,
  mode: "add" | "remove"
): string[] | null {
  const agentEntry = findAgentEntry(config, agentId);
  if (!agentEntry) {
    return null;
  }

  const currentSkills = readSkillNames(agentEntry.skills);
  if (mode === "add") {
    return currentSkills.some((value) => value === slug)
      ? currentSkills
      : [...currentSkills, slug];
  }

  return currentSkills.filter((value) => value !== slug);
}

function readCurrentSkills(config: Record<string, unknown>, agentId: string): string[] {
  const agentEntry = findAgentEntry(config, agentId);
  return readSkillNames(agentEntry?.skills);
}

function findAgentEntry(
  config: Record<string, unknown>,
  agentId: string
): Record<string, unknown> | null {
  const agentsConfig = config.agents;
  if (!isPlainObject(agentsConfig)) {
    return null;
  }

  const agentList = agentsConfig.list;
  if (!Array.isArray(agentList)) {
    return null;
  }

  const match = agentList.find((value) => isPlainObject(value) && value.id === agentId);
  return isPlainObject(match) ? match : null;
}

function readSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry: unknown): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/^\/+/, ""));
}

function sameSkills(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
