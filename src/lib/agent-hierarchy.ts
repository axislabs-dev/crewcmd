import type { Agent } from "@/lib/data";

export interface AgentHierarchyNode {
  agent: Agent;
  children: AgentHierarchyNode[];
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isMainAgent(agent: Agent): boolean {
  if (normalize(agent.runtimeRef) === "main") return true;
  if (normalize(agent.callsign) === "main") return true;
  return false;
}

export function compareAgentsForHierarchy(a: Agent, b: Agent): number {
  const aIsMain = isMainAgent(a);
  const bIsMain = isMainAgent(b);
  if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;

  const aPos = a.canvasPosition;
  const bPos = b.canvasPosition;
  if (aPos && bPos) {
    if (aPos.y !== bPos.y) return aPos.y - bPos.y;
    if (aPos.x !== bPos.x) return aPos.x - bPos.x;
  } else if (aPos || bPos) {
    return aPos ? -1 : 1;
  }

  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;

  return a.callsign.localeCompare(b.callsign, undefined, { sensitivity: "base" });
}

export function buildAgentHierarchy(agents: Agent[]): AgentHierarchyNode[] {
  const byCallsign = new Map<string, Agent>();
  for (const agent of agents) {
    byCallsign.set(normalize(agent.callsign), agent);
  }

  const childrenOf = new Map<string | null, Agent[]>();
  const pushChild = (parent: string | null, agent: Agent) => {
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(agent);
  };

  for (const agent of agents) {
    const parent = normalize(agent.reportsTo);
    pushChild(parent && byCallsign.has(parent) ? parent : null, agent);
  }

  function build(parentCallsign: string | null, ancestry = new Set<string>()): AgentHierarchyNode[] {
    const children = [...(childrenOf.get(parentCallsign) ?? [])].sort(compareAgentsForHierarchy);
    return children.map((agent) => {
      const callsign = normalize(agent.callsign);
      if (ancestry.has(callsign)) {
        return { agent, children: [] };
      }
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(callsign);
      return {
        agent,
        children: build(callsign, nextAncestry),
      };
    });
  }

  const roots = build(null);
  const seen = new Set<string>();
  const markSeen = (nodes: AgentHierarchyNode[]) => {
    for (const node of nodes) {
      seen.add(normalize(node.agent.callsign));
      markSeen(node.children);
    }
  };
  markSeen(roots);

  const detached = agents
    .filter((agent) => !seen.has(normalize(agent.callsign)))
    .sort(compareAgentsForHierarchy)
    .map((agent) => ({
      agent,
      children: build(normalize(agent.callsign), new Set([normalize(agent.callsign)])),
    }));

  return [...roots, ...detached];
}

export function flattenAgentHierarchy(nodes: AgentHierarchyNode[]): AgentHierarchyNode[] {
  const result: AgentHierarchyNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenAgentHierarchy(node.children));
  }
  return result;
}

export function findDefaultHierarchyAgent(agents: Agent[]): Agent | null {
  return buildAgentHierarchy(agents)[0]?.agent ?? null;
}
