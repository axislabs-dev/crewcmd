import { eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentWorkspaceGrants, agents, skills } from "@/db/schema";

export async function getAgentWithWorkspaceIds(agentId: string) {
  if (!db) return null;
  const [agent] = await withRetry(() => db!.select().from(agents).where(eq(agents.id, agentId)).limit(1));
  if (!agent) return null;
  const grants = await withRetry(() =>
    db!
      .select({ workspaceId: agentWorkspaceGrants.workspaceId })
      .from(agentWorkspaceGrants)
      .where(eq(agentWorkspaceGrants.agentId, agentId))
  );
  return { agent, workspaceIds: new Set(grants.map((grant) => grant.workspaceId)) };
}

export function skillMatchesAgentScope(
  skill: Pick<typeof skills.$inferSelect, "workspaceId" | "companyId">,
  agent: Pick<typeof agents.$inferSelect, "companyId">,
  workspaceIds: Set<string>
) {
  if (skill.workspaceId) return workspaceIds.has(skill.workspaceId);
  return skill.companyId != null && skill.companyId === agent.companyId;
}

export async function loadScopedSkillForAgent(params: { skillId: string; agentId: string }) {
  if (!db) return null;
  const scoped = await getAgentWithWorkspaceIds(params.agentId);
  if (!scoped) return null;
  const [skill] = await withRetry(() => db!.select().from(skills).where(eq(skills.id, params.skillId)).limit(1));
  if (!skill || !skillMatchesAgentScope(skill, scoped.agent, scoped.workspaceIds)) return null;
  return { agent: scoped.agent, workspaceIds: scoped.workspaceIds, skill };
}

export async function findScopedSkillBySlug(params: { agentCallsign: string; skillSlug: string }) {
  if (!db) return null;
  const dbAgents = await withRetry(() => db!.select().from(agents));
  const agent = dbAgents.find((row) => row.callsign.toLowerCase() === params.agentCallsign.toLowerCase());
  if (!agent) return null;
  const grants = await withRetry(() =>
    db!
      .select({ workspaceId: agentWorkspaceGrants.workspaceId })
      .from(agentWorkspaceGrants)
      .where(eq(agentWorkspaceGrants.agentId, agent.id))
  );
  const workspaceIds = new Set(grants.map((grant) => grant.workspaceId));
  const candidateSkills = await withRetry(() => db!.select().from(skills).where(eq(skills.slug, params.skillSlug)));
  const skill = candidateSkills.find((row) => skillMatchesAgentScope(row, agent, workspaceIds)) ?? null;
  return skill ? { agent, skill } : null;
}
