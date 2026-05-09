/**
 * Push the CrewCmd system skills to all imported agents on a runtime.
 *
 * This includes:
 * - crewcmd-management
 * - crewcmd-operating-layer
 * - crewcmd-orchestrator for the runtime's main agent
 */

import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, agents, companyRuntimes, skills } from "@/db/schema";
import { generateCrewCmdSkill } from "./crewcmd-skill-template";
import { generateCrewCmdOperatingLayerSkill } from "./crewcmd-operating-skill-template";
import { generateCrewCmdOrchestratorSkill } from "./crewcmd-orchestrator-skill-template";
import { CREWCMD_MANAGEMENT_SKILL_METADATA } from "./skills/crewcmd-management";
import { CREWCMD_OPERATING_LAYER_SKILL_METADATA } from "./skills/crewcmd-operating-layer";
import { CREWCMD_ORCHESTRATOR_SKILL_METADATA } from "./skills/crewcmd-orchestrator";
import { syncSkillToOpenClaw } from "./sync-skill-to-openclaw";
import { resolveRuntimeCallbackUrl } from "./runtime-callback-url";
import { upsertRuntimeManagedResource } from "./runtime-managed-resources";
import { resolveRuntimeWorkspace } from "./workspace";
import { getHeartbeatSecret } from "./heartbeat-secret";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { buildOperatingLayerConfig, inferRolePack } from "./operating-layer";
import { resolveRuntimeMainAgent } from "./runtime-main-agent";

const MANAGEMENT_SKILL_SLUG = "crewcmd-management";
const MANAGEMENT_SKILL_NAME = "CrewCmd Management";
const OPERATING_SKILL_SLUG = "crewcmd-operating-layer";
const OPERATING_SKILL_NAME = "CrewCmd Operating Layer";
const ORCHESTRATOR_SKILL_SLUG = "crewcmd-orchestrator";
const ORCHESTRATOR_SKILL_NAME = "CrewCmd Orchestrator";

export async function pushSkillToRuntime(runtimeId: string): Promise<void> {
  if (!db) throw new Error("Database not available");

  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, runtimeId)),
  );
  if (!runtime) throw new Error(`Runtime ${runtimeId} not found`);

  const baseUrl = resolveRuntimeCallbackUrl({ runtime });
  const workspace = await resolveRuntimeWorkspace(runtime);
  if (!workspace)
    throw new Error(`Workspace for runtime ${runtimeId} not found`);
  const storageCompanyId = runtime.companyId ?? runtime.ownerCompanyId ?? null;
  if (!storageCompanyId) {
    throw new Error(
      `Runtime ${runtimeId} is missing company skill storage scope`,
    );
  }

  const runtimeAgents = await withRetry(() =>
    db!.select().from(agents).where(eq(agents.runtimeId, runtimeId)),
  );
  const mainAgent = resolveRuntimeMainAgent(runtimeAgents, runtime);

  const managementContent = generateCrewCmdSkill({
    baseUrl,
    workspaceId: workspace.id,
    companyId: workspace.companyId ?? null,
  });
  const operatingContent = generateCrewCmdOperatingLayerSkill({
    rolePack: "developer",
    mode: "imported-overlay",
    overlayContent:
      "CrewCmd operating overlay is configured per-agent at assignment sync time.",
  });
  const orchestratorContent = generateCrewCmdOrchestratorSkill({
    baseUrl,
    workspaceId: workspace.id,
    companyId: workspace.companyId ?? null,
  });

  const managementSkill = await upsertSystemSkill({
    companyId: storageCompanyId,
    slug: MANAGEMENT_SKILL_SLUG,
    name: MANAGEMENT_SKILL_NAME,
    description:
      "Full workspace management — tasks, projects, agents, inbox, blueprints, budgets, docs, org chart, and activity.",
    content: managementContent,
    metadata: {
      ...CREWCMD_MANAGEMENT_SKILL_METADATA,
      configExample: {
        ...CREWCMD_MANAGEMENT_SKILL_METADATA.configExample,
        companyId: storageCompanyId,
        workspaceId: workspace.id,
        runtimeId: runtime.id,
      },
    },
  });
  const operatingSkill = await upsertSystemSkill({
    companyId: storageCompanyId,
    slug: OPERATING_SKILL_SLUG,
    name: OPERATING_SKILL_NAME,
    description:
      "CrewCmd operating overlay for workflow, audit, human-attention escalation, and developer delivery rules.",
    content: operatingContent,
    metadata: CREWCMD_OPERATING_LAYER_SKILL_METADATA,
  });
  const orchestratorSkill = await upsertSystemSkill({
    companyId: storageCompanyId,
    slug: ORCHESTRATOR_SKILL_SLUG,
    name: ORCHESTRATOR_SKILL_NAME,
    description:
      "Delegate-first CEO/orchestrator instructions for the OpenClaw main agent in a CrewCmd runtime.",
    content: orchestratorContent,
    metadata: {
      ...CREWCMD_ORCHESTRATOR_SKILL_METADATA,
      configExample: {
        ...CREWCMD_ORCHESTRATOR_SKILL_METADATA.configExample,
        companyId: storageCompanyId,
        workspaceId: workspace.id,
        runtimeId: runtime.id,
      },
    },
  });

  await upsertRuntimeManagedResource({
    runtimeId,
    companyId: storageCompanyId,
    resourceType: "skill-entry",
    resourceKey: MANAGEMENT_SKILL_SLUG,
    externalId: managementSkill.id,
    payload: {
      skillId: managementSkill.id,
      slug: MANAGEMENT_SKILL_SLUG,
      baseUrl,
      workspaceId: workspace.id,
      runtimeId: runtime.id,
    },
  });
  await upsertRuntimeManagedResource({
    runtimeId,
    companyId: storageCompanyId,
    resourceType: "skill-entry",
    resourceKey: OPERATING_SKILL_SLUG,
    externalId: operatingSkill.id,
    payload: {
      skillId: operatingSkill.id,
      slug: OPERATING_SKILL_SLUG,
      workspaceId: workspace.id,
      runtimeId: runtime.id,
    },
  });
  await upsertRuntimeManagedResource({
    runtimeId,
    companyId: storageCompanyId,
    resourceType: "skill-entry",
    resourceKey: ORCHESTRATOR_SKILL_SLUG,
    externalId: orchestratorSkill.id,
    payload: {
      skillId: orchestratorSkill.id,
      slug: ORCHESTRATOR_SKILL_SLUG,
      workspaceId: workspace.id,
      runtimeId: runtime.id,
      targetAgentId: mainAgent?.id ?? null,
      targetAgentRef: mainAgent?.runtimeRef ?? null,
    },
  });

  await linkSkillToAgents({
    skillId: managementSkill.id,
    runtimeAgents,
    baseUrl,
    companyId: workspace.companyId ?? null,
    workspaceId: workspace.id,
    runtimeId: runtime.id,
  });
  await linkSkillToAgents({
    skillId: operatingSkill.id,
    runtimeAgents,
    baseUrl,
    companyId: workspace.companyId ?? null,
    workspaceId: workspace.id,
    runtimeId: runtime.id,
    isOperatingLayer: true,
  });
  if (mainAgent) {
    await linkSkillToAgents({
      skillId: orchestratorSkill.id,
      runtimeAgents: [mainAgent],
      baseUrl,
      companyId: workspace.companyId ?? null,
      workspaceId: workspace.id,
      runtimeId: runtime.id,
      isMainOrchestrator: true,
    });
  }

  for (const agent of runtimeAgents) {
    await syncAssignment({
      runtimeId,
      storageCompanyId,
      agent,
      skillId: managementSkill.id,
      slug: MANAGEMENT_SKILL_SLUG,
    });
    await syncAssignment({
      runtimeId,
      storageCompanyId,
      agent,
      skillId: operatingSkill.id,
      slug: OPERATING_SKILL_SLUG,
    });
  }
  if (mainAgent) {
    await syncAssignment({
      runtimeId,
      storageCompanyId,
      agent: mainAgent,
      skillId: orchestratorSkill.id,
      slug: ORCHESTRATOR_SKILL_SLUG,
    });
  }

  await syncCrewCmdSkillHeartbeatSecret(runtime, MANAGEMENT_SKILL_SLUG);

  console.log(
    `[push-skill] Pushed CrewCmd skills to runtime ${runtimeId}: ${runtimeAgents.length} agents, main=${mainAgent?.callsign ?? "none"}, baseUrl=${baseUrl}`,
  );
}

async function upsertSystemSkill(params: {
  companyId: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string }> {
  if (!db) throw new Error("Database not available");

  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.companyId, params.companyId),
          eq(skills.slug, params.slug),
          eq(skills.source, "system"),
        ),
      ),
  );

  if (existing) {
    await withRetry(() =>
      db!
        .update(skills)
        .set({
          name: params.name,
          description: params.description,
          content: params.content,
          metadata: params.metadata,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing.id)),
    );
    return { id: existing.id };
  }

  const [created] = await withRetry(() =>
    db!
      .insert(skills)
      .values({
        companyId: params.companyId,
        name: params.name,
        slug: params.slug,
        description: params.description,
        source: "system",
        content: params.content,
        metadata: params.metadata,
        installed: true,
      })
      .returning({ id: skills.id }),
  );

  return created;
}

async function linkSkillToAgents(params: {
  skillId: string;
  runtimeAgents: (typeof agents.$inferSelect)[];
  baseUrl: string;
  companyId: string | null;
  workspaceId: string;
  runtimeId: string;
  isOperatingLayer?: boolean;
  isMainOrchestrator?: boolean;
}) {
  if (!db || params.runtimeAgents.length === 0) return;

  for (const agent of params.runtimeAgents) {
    const existingConfig =
      typeof agent.runtimeConfig === "object" && agent.runtimeConfig !== null
        ? (agent.runtimeConfig as Record<string, unknown>)
        : {};
    const persistedOperatingLayer =
      typeof existingConfig.operatingLayer === "object" &&
      existingConfig.operatingLayer !== null
        ? (existingConfig.operatingLayer as Record<string, unknown>)
        : null;

    const assignmentConfig = params.isMainOrchestrator
      ? {
          baseUrl: params.baseUrl,
          companyId: params.companyId,
          workspaceId: params.workspaceId,
          runtimeId: params.runtimeId,
          role: "CEO",
          delegationMode: "delegate-first",
        }
      : params.isOperatingLayer
        ? (persistedOperatingLayer ??
          buildOperatingLayerConfig({
            mode: "imported-overlay",
            rolePack: inferRolePack({
              role: agent.role,
              title: agent.title,
              callsign: agent.callsign,
            }),
            callsign: agent.callsign,
            workspaceId: params.workspaceId,
          }))
        : {
            baseUrl: params.baseUrl,
            companyId: params.companyId,
            workspaceId: params.workspaceId,
            runtimeId: params.runtimeId,
          };
    const assignmentConfigRecord = assignmentConfig as Record<string, unknown>;

    const [existing] = await withRetry(() =>
      db!
        .select()
        .from(agentSkills)
        .where(
          and(
            eq(agentSkills.agentId, agent.id),
            eq(agentSkills.skillId, params.skillId),
          ),
        ),
    );

    if (!existing) {
      await withRetry(() =>
        db!.insert(agentSkills).values({
          agentId: agent.id,
          skillId: params.skillId,
          enabled: true,
          config: assignmentConfigRecord,
        }),
      );
      continue;
    }

    await withRetry(() =>
      db!
        .update(agentSkills)
        .set({
          enabled: true,
          config: assignmentConfigRecord,
        })
        .where(eq(agentSkills.id, existing.id)),
    );
  }
}

async function syncAssignment(params: {
  runtimeId: string;
  storageCompanyId: string;
  agent: typeof agents.$inferSelect;
  skillId: string;
  slug: string;
}) {
  try {
    await syncSkillToOpenClaw({
      skillId: params.skillId,
      agentId: params.agent.id,
      companyId: params.storageCompanyId,
    });
    await upsertRuntimeManagedResource({
      runtimeId: params.runtimeId,
      companyId: params.storageCompanyId,
      resourceType: "agent-skill",
      resourceKey: `${params.agent.id}:${params.skillId}`,
      targetAgentId: params.agent.id,
      targetAgentRef: params.agent.runtimeRef ?? params.agent.id,
      externalId: params.skillId,
      payload: {
        skillId: params.skillId,
        slug: params.slug,
        agentId: params.agent.id,
        runtimeRef: params.agent.runtimeRef ?? params.agent.id,
      },
    });
  } catch (err) {
    console.warn(
      `[push-skill] Failed to sync ${params.slug} for ${params.agent.callsign}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function syncCrewCmdSkillHeartbeatSecret(
  runtime: typeof companyRuntimes.$inferSelect,
  skillKey: string,
): Promise<void> {
  const secret = await getHeartbeatSecret();
  if (!secret) return;

  const meta = (runtime.metadata || {}) as Record<string, unknown>;
  const deviceKeyPem =
    typeof meta.devicePrivateKeyPem === "string"
      ? meta.devicePrivateKeyPem
      : undefined;

  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000,
  );

  try {
    await client.connect();
    await client.skillsUpdate({
      skillKey,
      env: {
        HEARTBEAT_SECRET: secret,
        CREWCMD_RUNTIME_ID: runtime.id,
      },
    });
  } finally {
    client.close();
  }
}
