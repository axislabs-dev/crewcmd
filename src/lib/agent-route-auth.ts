import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { canReadAgent, getAgentAccessContext } from "@/lib/agent-access";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export type AgentRouteRecord = typeof schema.agents.$inferSelect;

export async function resolveReadableAgentByCallsign(
  callsign: string,
  request?: Request,
): Promise<AgentRouteRecord | null> {
  if (!db) return null;

  const access = await getAgentAccessContext();
  const dbAgents = await withRetry(() => db!.select().from(schema.agents));
  const agent = dbAgents.find((row) => row.callsign.toLowerCase() === callsign.toLowerCase());
  if (!agent) return null;

  if (canReadAgent(agent, access)) return agent;

  const workspace = await resolveAccessibleWorkspace({ request });
  if (!workspace) return null;

  const [grant] = await withRetry(() =>
    db!
      .select({ id: schema.agentWorkspaceGrants.id })
      .from(schema.agentWorkspaceGrants)
      .where(
        and(
          eq(schema.agentWorkspaceGrants.agentId, agent.id),
          eq(schema.agentWorkspaceGrants.workspaceId, workspace.id),
        ),
      )
      .limit(1),
  );

  return grant ? agent : null;
}
