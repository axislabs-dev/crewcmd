import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";
import type { BlueprintTemplate, BlueprintAgentTemplate } from "@/db/schema";
import { buildBlueprintOperatingLayer } from "@/lib/operating-layer";
import { resolveBlueprintAgentModelSelection } from "@/lib/model-profiles";
import type { RuntimeCapabilitySnapshot } from "@/lib/runtime-capabilities";
import { provisionBlueprintAgentsToRuntime } from "@/lib/blueprint-runtime-provisioning";
import { pushSkillToRuntime } from "@/lib/push-skill-to-runtime";
import { buildRuntimeAgentPersistenceConfig } from "@/lib/runtime-agent-credentials";
import {
  getAgentAccessContext,
  normalizeVisibilityForCreation,
  type AgentVisibility,
} from "@/lib/agent-access";
import {
  grantAgentDefaultWorkspace,
  grantAgentToWorkspace,
  listWorkspaceAgents,
  resolveAccessibleWorkspace,
  type WorkspaceRecord,
} from "@/lib/workspace";

/**
 * POST /api/blueprints/deploy — Deploy a blueprint to a company.
 * Creates agents, sets up reportsTo relationships, and auto-attaches matching skills.
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not available" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const { blueprintId, companyId, workspaceId, customize } = body as {
      blueprintId: string;
      companyId?: string;
      workspaceId?: string;
      customize?: { agents?: Partial<BlueprintAgentTemplate>[] };
    };

    if (!blueprintId) {
      return NextResponse.json(
        { error: "blueprintId is required" },
        { status: 400 },
      );
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const targetWorkspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? null,
    });
    if (!targetWorkspace) {
      return NextResponse.json(
        { error: "A readable workspace is required" },
        { status: 400 },
      );
    }

    // Resolve the blueprint template
    let template: BlueprintTemplate | null = null;
    let isBuiltIn = false;

    if (blueprintId.startsWith("builtin-")) {
      const slug = blueprintId.replace("builtin-", "");
      const bp = BUILT_IN_BLUEPRINTS.find((b) => b.slug === slug);
      if (!bp) {
        return NextResponse.json(
          { error: "Blueprint not found" },
          { status: 404 },
        );
      }
      template = bp.template;
      isBuiltIn = true;
    } else {
      const [row] = await withRetry(() =>
        db!
          .select()
          .from(schema.teamBlueprints)
          .where(eq(schema.teamBlueprints.id, blueprintId)),
      );
      if (!row) {
        return NextResponse.json(
          { error: "Blueprint not found" },
          { status: 404 },
        );
      }
      template = row.template;
    }

    // Apply customizations to agent templates
    const agentTemplates = template.agents.map((agent, idx) => {
      const overrides = customize?.agents?.[idx];
      return overrides ? { ...agent, ...overrides } : { ...agent };
    });
    const runtimeContext = await loadPrimaryRuntimeContext(targetWorkspace);
    const runtimeCapabilities = runtimeContext.capabilities;
    const blueprintCallsigns = new Set(
      agentTemplates.map((agent) => agent.callsign.toUpperCase()),
    );
    const runtimeMainAgent = runtimeContext.runtime
      ? await resolveRuntimeMainWorkspaceAgent({
          workspaceId: targetWorkspace.id,
          runtimeId: runtimeContext.runtime.id,
          defaultAgentId: readRuntimeDefaultAgentId(
            runtimeContext.runtime.metadata,
          ),
          excludeCallsigns: blueprintCallsigns,
        })
      : null;
    const workspaceOwnerType =
      targetWorkspace.type === "personal" ? "user" : "company";
    const effectiveOwnerType =
      runtimeContext.runtime?.ownerType ?? workspaceOwnerType;
    const effectiveOwnerUserId =
      runtimeContext.runtime?.ownerUserId ??
      (effectiveOwnerType === "user"
        ? (targetWorkspace.ownerUserId ?? access.userId)
        : null);
    const effectiveOwnerCompanyId =
      runtimeContext.runtime?.ownerCompanyId ??
      (effectiveOwnerType === "company" ? targetWorkspace.companyId : null);
    const effectiveVisibility: AgentVisibility = normalizeVisibilityForCreation({
      ownerType: effectiveOwnerType,
    });
    const storageCompanyId =
      runtimeContext.runtime?.companyId ?? targetWorkspace.companyId ?? null;

    const existingWorkspaceAgents = await loadExistingWorkspaceAgentsByCallsign(
      {
        workspaceId: targetWorkspace.id,
        callsigns: Array.from(blueprintCallsigns),
      },
    );
    await assertBlueprintCallsignsAvailable({
      callsigns: Array.from(blueprintCallsigns),
      allowedExistingAgentIds: new Set(
        Array.from(existingWorkspaceAgents.values()).map((agent) => agent.id),
      ),
    });

    let provisionedAgentsByCallsign = new Map<
      string,
      { runtimeRef: string; workspacePath: string | null }
    >();
    if (runtimeContext.runtime) {
      const provisioned = await provisionBlueprintAgentsToRuntime({
        runtime: runtimeContext.runtime,
        agentTemplates,
        runtimeCapabilities,
      });
      provisionedAgentsByCallsign = new Map(
        provisioned.agents.map((agent) => [
          agent.callsign.toUpperCase(),
          { runtimeRef: agent.runtimeRef, workspacePath: agent.workspacePath },
        ]),
      );
    }

    // Fetch existing company skills for auto-attach
    let companySkills: { id: string; slug: string }[] = [];
    try {
      companySkills = await withRetry(() =>
        db!
          .select({ id: schema.skills.id, slug: schema.skills.slug })
          .from(schema.skills)
          .where(
            storageCompanyId
              ? eq(schema.skills.companyId, storageCompanyId)
              : isNull(schema.skills.companyId),
          ),
      );
    } catch {
      // Skills lookup is best-effort
    }
    const skillSlugMap = new Map(companySkills.map((s) => [s.slug, s.id]));

    // Create or update agents. Re-deploying the same blueprint is an update, not a duplicate.
    const createdAgents: Record<string, { id: string; callsign: string }> = {};
    let createdCount = 0;
    let updatedCount = 0;

    for (const tmpl of agentTemplates) {
      const adapterConfig: Record<string, unknown> = {};
      if (tmpl.promptTemplate)
        adapterConfig.promptTemplate = tmpl.promptTemplate;
      if (tmpl.adapterType === "openrouter") {
        adapterConfig.baseUrl = "https://openrouter.ai/api/v1";
      }
      const resolvedModel = resolveBlueprintAgentModelSelection(
        tmpl,
        runtimeCapabilities,
      );
      const provisionedAgent = provisionedAgentsByCallsign.get(
        tmpl.callsign.toUpperCase(),
      );
      const runtimeAdapterConfig = runtimeContext.runtime
        ? buildRuntimeAgentPersistenceConfig(runtimeContext.runtime.httpUrl)
        : null;

      const callsign = tmpl.callsign.toUpperCase();
      const agentValues = {
        callsign,
        name: tmpl.name,
        title: tmpl.title,
        emoji: tmpl.emoji,
        color: tmpl.color,
        role: tmpl.role,
        adapterType: runtimeContext.runtime
          ? "openclaw_gateway"
          : tmpl.adapterType,
        model: resolvedModel.primaryModel ?? tmpl.model ?? null,
        adapterConfig: runtimeAdapterConfig ?? adapterConfig,
        workspacePath: provisionedAgent?.workspacePath ?? null,
        runtimeId: runtimeContext.runtime?.id ?? null,
        runtimeRef: provisionedAgent?.runtimeRef ?? null,
        runtimeConfig: {
          operatingLayer: buildBlueprintOperatingLayer({
            callsign,
            rolePack: tmpl.rolePack,
            modelProfile: resolvedModel.profile,
            fallbackProfiles: resolvedModel.fallbackProfiles,
            curatedSkills: tmpl.curatedSkillMetadata,
            identityRaw: tmpl.identityContent,
            soulRaw: tmpl.soulContent,
            agentsRaw: tmpl.agentsContent,
          }),
        },
        companyId: targetWorkspace.companyId,
        ownerType: effectiveOwnerType,
        ownerUserId: effectiveOwnerUserId,
        ownerCompanyId: effectiveOwnerCompanyId,
        visibility: effectiveVisibility,
        reportsTo: null, // Set in second pass
        soulContent: tmpl.soulContent ?? tmpl.promptTemplate ?? null,
      };

      const existingAgent = existingWorkspaceAgents.get(callsign);
      const [created] = existingAgent
        ? await withRetry(() =>
            db!
              .update(schema.agents)
              .set(agentValues)
              .where(eq(schema.agents.id, existingAgent.id))
              .returning(),
          )
        : await withRetry(() =>
            db!.insert(schema.agents).values(agentValues).returning(),
          );

      if (existingAgent) updatedCount += 1;
      else createdCount += 1;

      createdAgents[callsign] = { id: created.id, callsign: created.callsign };

      await grantAgentDefaultWorkspace({
        agentId: created.id,
        ownerType: effectiveOwnerType,
        ownerUserId: effectiveOwnerUserId,
        ownerCompanyId: effectiveOwnerCompanyId,
        fallbackCompanyId: targetWorkspace.companyId,
        grantedBy: access.userId,
      });
      await grantAgentToWorkspace({
        agentId: created.id,
        workspaceId: targetWorkspace.id,
        accessLevel: effectiveOwnerType === "company" ? "operator" : "manager",
        grantedBy: access.userId,
      });
    }

    // Set up reportsTo relationships (second pass)
    for (const tmpl of agentTemplates) {
      const agent = createdAgents[tmpl.callsign.toUpperCase()];
      if (!agent) continue;

      if (tmpl.reportsTo) {
        const manager = createdAgents[tmpl.reportsTo.toUpperCase()];
        if (agent && manager) {
          await withRetry(() =>
            db!
              .update(schema.agents)
              .set({ reportsTo: manager.callsign })
              .where(eq(schema.agents.id, agent.id)),
          );
        }
      } else if (runtimeMainAgent) {
        await withRetry(() =>
          db!
            .update(schema.agents)
            .set({ reportsTo: runtimeMainAgent.callsign })
            .where(eq(schema.agents.id, agent.id)),
        );
      }
    }

    // Auto-attach skills
    for (const tmpl of agentTemplates) {
      if (tmpl.skills && tmpl.skills.length > 0) {
        const agent = createdAgents[tmpl.callsign.toUpperCase()];
        if (!agent) continue;

        for (const skillSlug of tmpl.skills) {
          const skillId = skillSlugMap.get(skillSlug);
          if (skillId) {
            try {
              await ensureAgentSkillAttached(agent.id, skillId);
            } catch {
              // Skill attachment is best-effort
            }
          }
        }
      }
    }

    const orgChartResult = await syncBlueprintOrgChart({
      workspaceId: targetWorkspace.id,
      companyId: storageCompanyId,
      agentTemplates,
      createdAgents,
    });

    if (runtimeContext.runtime) {
      await pushSkillToRuntime(runtimeContext.runtime.id);
    }

    // Increment popularity if it's a DB blueprint
    if (!isBuiltIn) {
      try {
        const [current] = await withRetry(() =>
          db!
            .select({ popularity: schema.teamBlueprints.popularity })
            .from(schema.teamBlueprints)
            .where(eq(schema.teamBlueprints.id, blueprintId)),
        );
        if (current) {
          await withRetry(() =>
            db!
              .update(schema.teamBlueprints)
              .set({
                popularity: current.popularity + 1,
                updatedAt: new Date(),
              })
              .where(eq(schema.teamBlueprints.id, blueprintId)),
          );
        }
      } catch {
        // Popularity increment is best-effort
      }
    }

    const agents = Object.values(createdAgents);
    return NextResponse.json(
      {
        success: true,
        agents,
        count: agents.length,
        createdCount,
        updatedCount,
        runtimeProvisioned: Boolean(runtimeContext.runtime),
        orgChartSynced: orgChartResult.synced,
        orgChartNodeCount: orgChartResult.count,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/blueprints/deploy] Error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("unique") ||
      msg.includes("duplicate") ||
      msg.toLowerCase().includes("callsigns already exist")
    ) {
      return NextResponse.json(
        {
          error:
            "One or more agent callsigns already exist. Rename agents before deploying.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to deploy blueprint" },
      { status: 500 },
    );
  }
}

async function loadPrimaryRuntimeContext(workspace: WorkspaceRecord): Promise<{
  runtime: {
    id: string;
    companyId: string | null;
    ownerType: "user" | "company";
    ownerUserId: string | null;
    ownerCompanyId: string | null;
    gatewayUrl: string;
    httpUrl: string;
    authToken: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  capabilities: RuntimeCapabilitySnapshot | null;
}> {
  const [runtime] = await withRetry(() =>
    db!
      .select({
        id: schema.companyRuntimes.id,
        companyId: schema.companyRuntimes.companyId,
        ownerType: schema.companyRuntimes.ownerType,
        ownerUserId: schema.companyRuntimes.ownerUserId,
        ownerCompanyId: schema.companyRuntimes.ownerCompanyId,
        gatewayUrl: schema.companyRuntimes.gatewayUrl,
        httpUrl: schema.companyRuntimes.httpUrl,
        authToken: schema.companyRuntimes.authToken,
        metadata: schema.companyRuntimes.metadata,
      })
      .from(schema.companyRuntimes)
      .where(buildPrimaryRuntimeWhere(workspace))
      .orderBy(desc(schema.companyRuntimes.updatedAt))
      .limit(1),
  );

  const metadata =
    runtime?.metadata &&
    typeof runtime.metadata === "object" &&
    !Array.isArray(runtime.metadata)
      ? (runtime.metadata as Record<string, unknown>)
      : null;
  const snapshot = metadata?.capabilitySnapshot;

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      runtime: runtime
        ? {
            id: runtime.id,
            companyId: runtime.companyId,
            ownerType: runtime.ownerType,
            ownerUserId: runtime.ownerUserId,
            ownerCompanyId: runtime.ownerCompanyId ?? runtime.companyId,
            gatewayUrl: runtime.gatewayUrl,
            httpUrl: runtime.httpUrl,
            authToken: runtime.authToken,
            metadata,
          }
        : null,
      capabilities: null,
    };
  }

  return {
    runtime: runtime
      ? {
          id: runtime.id,
          companyId: runtime.companyId,
          ownerType: runtime.ownerType,
          ownerUserId: runtime.ownerUserId,
          ownerCompanyId: runtime.ownerCompanyId ?? runtime.companyId,
          gatewayUrl: runtime.gatewayUrl,
          httpUrl: runtime.httpUrl,
          authToken: runtime.authToken,
          metadata,
        }
      : null,
    capabilities: snapshot as RuntimeCapabilitySnapshot,
  };
}

function buildPrimaryRuntimeWhere(workspace: WorkspaceRecord) {
  if (workspace.type === "personal") {
    return and(
      eq(schema.companyRuntimes.ownerType, "user"),
      eq(schema.companyRuntimes.ownerUserId, workspace.ownerUserId ?? ""),
      eq(schema.companyRuntimes.isPrimary, true),
    );
  }

  return and(
    eq(schema.companyRuntimes.ownerType, "company"),
    or(
      eq(schema.companyRuntimes.ownerCompanyId, workspace.companyId ?? ""),
      eq(schema.companyRuntimes.companyId, workspace.companyId ?? ""),
    )!,
    eq(schema.companyRuntimes.isPrimary, true),
  );
}

function readRuntimeDefaultAgentId(
  metadata: Record<string, unknown> | null,
): string | null {
  const value = metadata?.defaultAgentId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveRuntimeMainWorkspaceAgent(params: {
  workspaceId: string;
  runtimeId: string;
  defaultAgentId: string | null;
  excludeCallsigns: Set<string>;
}): Promise<{ id: string; callsign: string } | null> {
  const agents = await listWorkspaceAgents(params.workspaceId, {
    runtimeId: params.runtimeId,
    includeDetached: true,
  });
  const existingAgents = agents.filter(
    (agent) => !params.excludeCallsigns.has(agent.callsign.toUpperCase()),
  );
  if (existingAgents.length === 0) return null;

  const defaultRuntimeRef = params.defaultAgentId?.toLowerCase();
  const byRuntimeRef = (runtimeRef: string) =>
    existingAgents.find(
      (agent) => agent.runtimeRef?.toLowerCase() === runtimeRef,
    );

  const mainAgent =
    (defaultRuntimeRef ? byRuntimeRef(defaultRuntimeRef) : null) ??
    byRuntimeRef("main") ??
    existingAgents.find((agent) => agent.callsign.toUpperCase() === "MAIN") ??
    existingAgents.find((agent) => !agent.reportsTo) ??
    existingAgents[0];

  return mainAgent ? { id: mainAgent.id, callsign: mainAgent.callsign } : null;
}

async function loadExistingWorkspaceAgentsByCallsign(params: {
  workspaceId: string;
  callsigns: string[];
}): Promise<Map<string, { id: string; callsign: string }>> {
  const callsignSet = new Set(
    params.callsigns.map((callsign) => callsign.toUpperCase()),
  );
  const workspaceAgents = await listWorkspaceAgents(params.workspaceId, {
    includeDetached: true,
  });
  return new Map(
    workspaceAgents
      .filter((agent) => callsignSet.has(agent.callsign.toUpperCase()))
      .map((agent) => [
        agent.callsign.toUpperCase(),
        { id: agent.id, callsign: agent.callsign },
      ]),
  );
}

async function assertBlueprintCallsignsAvailable(params: {
  callsigns: string[];
  allowedExistingAgentIds: Set<string>;
}): Promise<void> {
  const existing = await withRetry(() =>
    db!
      .select({ id: schema.agents.id, callsign: schema.agents.callsign })
      .from(schema.agents)
      .where(inArray(schema.agents.callsign, params.callsigns)),
  );

  const conflicts = existing.filter(
    (row) => !params.allowedExistingAgentIds.has(row.id),
  );
  if (conflicts.length > 0) {
    throw new Error(
      "One or more agent callsigns already exist. Rename agents before deploying.",
    );
  }
}

async function ensureAgentSkillAttached(agentId: string, skillId: string) {
  const [existing] = await withRetry(() =>
    db!
      .select({ id: schema.agentSkills.id })
      .from(schema.agentSkills)
      .where(
        and(
          eq(schema.agentSkills.agentId, agentId),
          eq(schema.agentSkills.skillId, skillId),
        ),
      )
      .limit(1),
  );

  if (existing) return existing;

  const [created] = await withRetry(() =>
    db!
      .insert(schema.agentSkills)
      .values({ agentId, skillId, enabled: true, config: {} })
      .returning({ id: schema.agentSkills.id }),
  );
  return created;
}

async function syncBlueprintOrgChart(params: {
  workspaceId: string;
  companyId: string | null;
  agentTemplates: BlueprintAgentTemplate[];
  createdAgents: Record<string, { id: string; callsign: string }>;
}): Promise<{ synced: boolean; count: number }> {
  if (!params.companyId) return { synced: false, count: 0 };

  const agentIds = Object.values(params.createdAgents).map((agent) => agent.id);
  if (agentIds.length === 0) return { synced: true, count: 0 };

  const existingNodes = await withRetry(() =>
    db!
      .select({
        id: schema.orgChartNodes.id,
        agentId: schema.orgChartNodes.agentId,
      })
      .from(schema.orgChartNodes)
      .where(
        and(
          eq(schema.orgChartNodes.companyId, params.companyId!),
          inArray(schema.orgChartNodes.agentId, agentIds),
        ),
      ),
  );

  const nodesByAgentId = new Map(
    existingNodes.map((node) => [node.agentId, node.id]),
  );

  for (const [index, tmpl] of params.agentTemplates.entries()) {
    const agent = params.createdAgents[tmpl.callsign.toUpperCase()];
    if (!agent) continue;
    const existingNodeId = nodesByAgentId.get(agent.id);
    if (existingNodeId) {
      await withRetry(() =>
        db!
          .update(schema.orgChartNodes)
          .set({
            workspaceId: params.workspaceId,
            positionTitle: tmpl.title,
            canDelegate: true,
            sortIndex: index,
            updatedAt: new Date(),
          })
          .where(eq(schema.orgChartNodes.id, existingNodeId)),
      );
    } else {
      const [created] = await withRetry(() =>
        db!
          .insert(schema.orgChartNodes)
          .values({
            workspaceId: params.workspaceId,
            companyId: params.companyId!,
            agentId: agent.id,
            parentNodeId: null,
            positionTitle: tmpl.title,
            canDelegate: true,
            sortIndex: index,
          })
          .returning({ id: schema.orgChartNodes.id }),
      );
      nodesByAgentId.set(agent.id, created.id);
    }
  }

  for (const tmpl of params.agentTemplates) {
    const agent = params.createdAgents[tmpl.callsign.toUpperCase()];
    if (!agent) continue;
    const nodeId = nodesByAgentId.get(agent.id);
    if (!nodeId) continue;

    const manager = tmpl.reportsTo
      ? params.createdAgents[tmpl.reportsTo.toUpperCase()]
      : null;
    const parentNodeId = manager
      ? (nodesByAgentId.get(manager.id) ?? null)
      : null;

    await withRetry(() =>
      db!
        .update(schema.orgChartNodes)
        .set({ parentNodeId, updatedAt: new Date() })
        .where(eq(schema.orgChartNodes.id, nodeId)),
    );
  }

  return { synced: true, count: nodesByAgentId.size };
}
