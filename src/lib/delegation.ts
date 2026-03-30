import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { orgChartNodes, tasks } from "@/db/schema";
import { logAudit } from "@/lib/governance";

interface OrgTreeNode {
  id: string;
  agentId: string;
  positionTitle: string;
  canDelegate: boolean;
  sortIndex: number;
  children: OrgTreeNode[];
}

/**
 * Get the full org chart tree for a company as a nested structure.
 */
export async function getOrgTree(companyId: string): Promise<OrgTreeNode[]> {
  if (!db) return [];

  const nodes = await db
    .select()
    .from(orgChartNodes)
    .where(eq(orgChartNodes.companyId, companyId));

  // Build a map of id → node with empty children
  const nodeMap = new Map<string, OrgTreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      agentId: n.agentId,
      positionTitle: n.positionTitle,
      canDelegate: n.canDelegate,
      sortIndex: n.sortIndex,
      children: [],
    });
  }

  // Build tree by attaching children to parents
  const roots: OrgTreeNode[] = [];
  for (const n of nodes) {
    const treeNode = nodeMap.get(n.id)!;
    if (n.parentNodeId && nodeMap.has(n.parentNodeId)) {
      nodeMap.get(n.parentNodeId)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  // Sort children by sortIndex
  function sortChildren(node: OrgTreeNode) {
    node.children.sort((a, b) => a.sortIndex - b.sortIndex);
    node.children.forEach(sortChildren);
  }
  roots.sort((a, b) => a.sortIndex - b.sortIndex);
  roots.forEach(sortChildren);

  return roots;
}

/**
 * Get direct reports for an agent in the org chart.
 */
export async function getReports(agentId: string, companyId: string) {
  if (!db) return [];

  // Find the node for this agent
  const [agentNode] = await db
    .select()
    .from(orgChartNodes)
    .where(
      and(
        eq(orgChartNodes.agentId, agentId),
        eq(orgChartNodes.companyId, companyId)
      )
    )
    .limit(1);

  if (!agentNode) return [];

  // Find nodes whose parentNodeId matches
  const reports = await db
    .select()
    .from(orgChartNodes)
    .where(
      and(
        eq(orgChartNodes.parentNodeId, agentNode.id),
        eq(orgChartNodes.companyId, companyId)
      )
    );

  return reports;
}

/**
 * Get the chain of command (managers) for an agent, from direct manager up to root.
 */
export async function getManagers(agentId: string, companyId: string) {
  if (!db) return [];

  const allNodes = await db
    .select()
    .from(orgChartNodes)
    .where(eq(orgChartNodes.companyId, companyId));

  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  // Find the agent's node
  const agentNode = allNodes.find((n) => n.agentId === agentId);
  if (!agentNode) return [];

  // Walk up the chain
  const managers: typeof allNodes = [];
  let currentParentId = agentNode.parentNodeId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = nodeMap.get(currentParentId);
    if (!parent) break;
    managers.push(parent);
    currentParentId = parent.parentNodeId;
  }

  return managers;
}

/**
 * Check if fromAgent is above toAgent in the org hierarchy (can delegate).
 */
export async function canDelegate(
  fromAgentId: string,
  toAgentId: string,
  companyId: string
): Promise<boolean> {
  if (!db) return false;

  // Get the managers chain for toAgent — if fromAgent is in it, delegation is valid
  const toManagers = await getManagers(toAgentId, companyId);
  const isAbove = toManagers.some((m) => m.agentId === fromAgentId);
  if (!isAbove) return false;

  // Check that the fromAgent's node has canDelegate enabled
  const allNodes = await db
    .select()
    .from(orgChartNodes)
    .where(
      and(
        eq(orgChartNodes.agentId, fromAgentId),
        eq(orgChartNodes.companyId, companyId)
      )
    )
    .limit(1);

  const fromNode = allNodes[0];
  return fromNode?.canDelegate ?? false;
}

/**
 * Delegate (reassign) a task from one agent to a report, with validation and audit.
 */
export async function delegateTask(
  taskId: string,
  fromAgentId: string,
  toAgentId: string,
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: "Database not configured" };

  const allowed = await canDelegate(fromAgentId, toAgentId, companyId);
  if (!allowed) {
    return {
      success: false,
      error: `${fromAgentId} cannot delegate to ${toAgentId} — not in hierarchy or delegation disabled`,
    };
  }

  // Reassign the task
  await db
    .update(tasks)
    .set({
      assignedAgentId: toAgentId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  await logAudit(companyId, fromAgentId, "delegated", "task", taskId, {
    fromAgentId,
    toAgentId,
  });

  return { success: true };
}
