import type { Agent } from "@/lib/data";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function buildAgentLookup(agents: Agent[]) {
  const lookup = new Map<string, Agent>();

  for (const agent of agents) {
    const callsign = normalize(agent.callsign);
    const id = normalize(agent.id);

    lookup.set(id, agent);
    lookup.set(callsign, agent);
    lookup.set(`agent-${callsign}`, agent);
  }

  return lookup;
}

export function findAgentByReference(agents: Agent[], reference: string | null | undefined) {
  if (!reference) return null;

  const lookup = buildAgentLookup(agents);
  const key = normalize(reference);

  return (
    lookup.get(key) ??
    (key.startsWith("agent-") ? lookup.get(key.slice("agent-".length)) : lookup.get(`agent-${key}`)) ??
    null
  );
}

export function resolveAssignedAgentValue(agents: Agent[], reference: string | null | undefined) {
  if (!reference) return "";
  return findAgentByReference(agents, reference)?.id ?? reference;
}

export function getUnknownAgentOption(reference: string | null | undefined, agents: Agent[]) {
  if (!reference) return null;
  if (findAgentByReference(agents, reference)) return null;
  return {
    value: reference,
    label: `Unknown agent (${reference})`,
  };
}
