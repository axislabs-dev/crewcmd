import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, agents, skills } from "@/db/schema";
import { resolveSecretRef } from "@/lib/service-secrets";

export interface ServiceSkillInvocation {
  agentCallsign: string;
  skillSlug: string;
  action: string;
  input?: Record<string, unknown>;
}

export interface ServiceSkillResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ServiceSkillHandlerContext {
  companyId: string;
  agent: typeof agents.$inferSelect;
  skill: typeof skills.$inferSelect;
  assignment: typeof agentSkills.$inferSelect;
  config: Record<string, unknown>;
}

export interface ServiceSkillHandler {
  invoke(action: string, input: Record<string, unknown> | undefined, context: ServiceSkillHandlerContext): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function resolveAssignment(agentCallsign: string, skillSlug: string) {
  if (!db) {
    throw new Error("Database not available");
  }

  const dbAgents = await withRetry(() => db!.select().from(agents));
  const agent = dbAgents.find((row) => row.callsign.toLowerCase() === agentCallsign.toLowerCase());
  if (!agent) {
    throw new Error(`Agent not found: ${agentCallsign}`);
  }

  if (!agent.companyId) {
    throw new Error(`Agent ${agent.callsign} is not attached to a company`);
  }

  const [skill] = await withRetry(() =>
    db!
      .select()
      .from(skills)
      .where(and(eq(skills.companyId, agent.companyId!), eq(skills.slug, skillSlug)))
      .limit(1)
  );

  if (!skill) {
    throw new Error(`Skill not found: ${skillSlug}`);
  }

  const [assignment] = await withRetry(() =>
    db!
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.agentId, agent.id), eq(agentSkills.skillId, skill.id)))
      .limit(1)
  );

  if (!assignment || !assignment.enabled) {
    throw new Error(`Skill ${skillSlug} is not enabled for agent ${agent.callsign}`);
  }

  const metadata = isRecord(skill.metadata) ? skill.metadata : {};
  if (metadata.kind !== "service-skill") {
    throw new Error(`Skill ${skillSlug} is not a service skill`);
  }

  return { agent, skill, assignment, metadata };
}

function getCapabilities(metadata: Record<string, unknown>): string[] {
  const capabilities = metadata.capabilities;
  if (!Array.isArray(capabilities)) return [];
  return capabilities.filter((value): value is string => typeof value === "string");
}

async function createContext(invocation: ServiceSkillInvocation): Promise<ServiceSkillHandlerContext & { metadata: Record<string, unknown> }> {
  const resolved = await resolveAssignment(invocation.agentCallsign, invocation.skillSlug);
  const config = isRecord(resolved.assignment.config) ? { ...resolved.assignment.config } : {};

  const capabilities = getCapabilities(resolved.metadata);
  const capabilityKey = invocation.action.replace(/\./g, ":");
  if (capabilities.length > 0 && !capabilities.includes(capabilityKey)) {
    throw new Error(`Action ${invocation.action} is not declared by skill ${invocation.skillSlug}`);
  }

  const secretValue = await resolveSecretRef(resolved.agent.companyId!, config.secretRef);
  if (secretValue) {
    config.__resolvedSecret = secretValue;
  }

  return {
    companyId: resolved.agent.companyId!,
    agent: resolved.agent,
    skill: resolved.skill,
    assignment: resolved.assignment,
    config,
    metadata: resolved.metadata,
  };
}

const serviceSkillHandlers: Record<string, () => Promise<ServiceSkillHandler>> = {
  evercontent: async () => import("@/lib/service-skills/evercontent").then((mod) => mod.evercontentServiceSkillHandler),
};

export async function invokeServiceSkill(invocation: ServiceSkillInvocation): Promise<ServiceSkillResult> {
  try {
    const context = await createContext(invocation);
    const service = context.metadata.service;
    if (typeof service !== "string" || !service) {
      throw new Error(`Skill ${invocation.skillSlug} is missing metadata.service`);
    }

    const loadHandler = serviceSkillHandlers[service];
    if (!loadHandler) {
      throw new Error(`No service-skill handler registered for ${service}`);
    }

    const handler = await loadHandler();
    const data = await handler.invoke(invocation.action, invocation.input, context);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
