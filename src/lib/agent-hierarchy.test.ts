import { describe, expect, it } from "vitest";
import type { Agent } from "@/lib/data";
import {
  buildAgentHierarchy,
  compareAgentsForHierarchy,
  findDefaultHierarchyAgent,
} from "@/lib/agent-hierarchy";

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    callsign: overrides.callsign ?? "AGENT",
    name: overrides.name ?? overrides.callsign ?? "Agent",
    title: overrides.title ?? "Agent",
    emoji: overrides.emoji ?? "🤖",
    color: overrides.color ?? "#fff",
    status: overrides.status ?? "offline",
    currentTask: overrides.currentTask ?? null,
    lastActive: overrides.lastActive ?? new Date().toISOString(),
    reportsTo: overrides.reportsTo ?? null,
    soulContent: overrides.soulContent ?? null,
    adapterType: overrides.adapterType ?? "openclaw_gateway",
    adapterConfig: overrides.adapterConfig ?? {},
    role: overrides.role ?? "engineer",
    model: overrides.model ?? null,
    workspacePath: overrides.workspacePath ?? null,
    runtimeId: overrides.runtimeId ?? null,
    runtimeRef: overrides.runtimeRef ?? null,
    ownerType: overrides.ownerType,
    ownerUserId: overrides.ownerUserId ?? null,
    ownerCompanyId: overrides.ownerCompanyId ?? null,
    visibility: overrides.visibility,
    workspaceIds: overrides.workspaceIds,
    canvasPosition: overrides.canvasPosition ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    tokenUsage: overrides.tokenUsage ?? null,
    modelAssessment: overrides.modelAssessment ?? null,
  };
}

describe("agent hierarchy", () => {
  it("prioritizes the runtime main agent", () => {
    const scout = makeAgent({ callsign: "SCOUT", name: "Scout" });
    const neo = makeAgent({ callsign: "NEO", name: "Neo", runtimeRef: "main" });

    expect([scout, neo].sort(compareAgentsForHierarchy).map((agent) => agent.callsign)).toEqual([
      "NEO",
      "SCOUT",
    ]);
    expect(findDefaultHierarchyAgent([scout, neo])?.callsign).toBe("NEO");
  });

  it("uses hierarchy and canvas position for sibling ordering", () => {
    const root = makeAgent({ callsign: "NEO", name: "Neo", runtimeRef: "main" });
    const left = makeAgent({
      callsign: "FORGE",
      name: "Forge",
      reportsTo: "NEO",
      canvasPosition: { x: 100, y: 200 },
    });
    const right = makeAgent({
      callsign: "PIXEL",
      name: "Pixel",
      reportsTo: "NEO",
      canvasPosition: { x: 300, y: 200 },
    });

    const tree = buildAgentHierarchy([right, left, root]);
    expect(tree.map((node) => node.agent.callsign)).toEqual(["NEO"]);
    expect(tree[0]?.children.map((node) => node.agent.callsign)).toEqual([
      "FORGE",
      "PIXEL",
    ]);
  });
});
