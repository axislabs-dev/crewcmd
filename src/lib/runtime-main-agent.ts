export interface RuntimeMainAgentCandidate {
  id: string;
  callsign: string;
  name?: string | null;
  title?: string | null;
  runtimeRef?: string | null;
}

export function resolveRuntimeMainAgent<T extends RuntimeMainAgentCandidate>(
  runtimeAgents: T[],
  runtime: { metadata?: Record<string, unknown> | null },
): T | null {
  if (runtimeAgents.length === 0) return null;

  const metadata =
    runtime.metadata && typeof runtime.metadata === "object"
      ? runtime.metadata
      : {};
  const defaultAgentId =
    typeof metadata.defaultAgentId === "string"
      ? metadata.defaultAgentId.trim().toLowerCase()
      : "";

  const byRuntimeRef = (value: string) =>
    runtimeAgents.find((agent) => agent.runtimeRef?.toLowerCase() === value);
  const byCallsign = (value: string) =>
    runtimeAgents.find((agent) => agent.callsign.toLowerCase() === value);
  const byName = (value: string) =>
    runtimeAgents.find((agent) => agent.name?.toLowerCase() === value);

  if (defaultAgentId) {
    const defaultMatch =
      byRuntimeRef(defaultAgentId) ??
      runtimeAgents.find(
        (agent) => agent.id.toLowerCase() === defaultAgentId,
      ) ??
      byCallsign(defaultAgentId);
    if (defaultMatch) return defaultMatch;
  }

  return (
    byRuntimeRef("main") ??
    byCallsign("main") ??
    byName("main") ??
    runtimeAgents.find((agent) =>
      /\b(main|orchestrator|ceo|chief)\b/i.test(agent.title ?? ""),
    ) ??
    null
  );
}
