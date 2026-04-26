import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";
import type { BlueprintTemplate, BlueprintAgentTemplate } from "@/db/schema";
import { buildBlueprintOperatingLayer } from "@/lib/operating-layer";
import { resolveBlueprintAgentModelSelection } from "@/lib/model-profiles";
import type { RuntimeCapabilitySnapshot } from "@/lib/runtime-capabilities";
import {
  provisionBlueprintAgentsToRuntime,
  provisionBlueprintMainAgentToRuntime,
} from "@/lib/blueprint-runtime-provisioning";
import { pushSkillToRuntime } from "@/lib/push-skill-to-runtime";
import { getAgentAccessContext, normalizeVisibilityForCreation } from "@/lib/agent-access";
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
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
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
        { status: 400 }
      );
    }

    const access = await getAgentAccessContext();
    if (!access.userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const targetWorkspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? null,
    });
    if (!targetWorkspace) {
      return NextResponse.json({ error: "A readable workspace is required" }, { status: 400 });
    }

    // Resolve the blueprint template
    let template: BlueprintTemplate | null = null;
    let isBuiltIn = false;

    if (blueprintId.startsWith("builtin-")) {
      const slug = blueprintId.replace("builtin-", "");
      const bp = BUILT_IN_BLUEPRINTS.find((b) => b.slug === slug);
      if (!bp) {
        return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
      }
      template = bp.template;
      isBuiltIn = true;
    } else {
      const [row] = await withRetry(() =>
        db!.select().from(schema.teamBlueprints).where(eq(schema.teamBlueprints.id, blueprintId))
      );
      if (!row) {
        return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
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
    const mergeSingleAgentBlueprintIntoMain = Boolean(runtimeContext.runtime && agentTemplates.length === 1);
    const blueprintCallsigns = new Set(agentTemplates.map((agent) => agent.callsign.toUpperCase()));
    const runtimeMainAgent = runtimeContext.runtime
      ? await resolveRuntimeMainWorkspaceAgent({
          workspaceId: targetWorkspace.id,
          runtimeId: runtimeContext.runtime.id,
          defaultAgentId: readRuntimeDefaultAgentId(runtimeContext.runtime.metadata),
          excludeCallsigns: blueprintCallsigns,
        })
      : null;
    const workspaceOwnerType = targetWorkspace.type === "personal" ? "user" : "company";
    const effectiveOwnerType = runtimeContext.runtime?.ownerType ?? workspaceOwnerType;
    const effectiveOwnerUserId =
      runtimeContext.runtime?.ownerUserId ??
      (effectiveOwnerType === "user" ? targetWorkspace.ownerUserId ?? access.userId : null);
    const effectiveOwnerCompanyId =
      runtimeContext.runtime?.ownerCompanyId ??
      (effectiveOwnerType === "company" ? targetWorkspace.companyId : null);
    const effectiveVisibility = normalizeVisibilityForCreation({ ownerType: effectiveOwnerType });
    const storageCompanyId = runtimeContext.runtime?.companyId ?? targetWorkspace.companyId ?? null;

    await assertBlueprintCallsignsAvailable(agentTemplates, {
      ignoreAgentId: mergeSingleAgentBlueprintIntoMain ? runtimeMainAgent?.id ?? null : null,
    });

    let provisionedAgentsByCallsign = new Map<string, { runtimeRef: string; workspacePath: string | null }>();
    if (runtimeContext.runtime) {
      const provisioned = mergeSingleAgentBlueprintIntoMain
        ? {
            agents: [
              (await provisionBlueprintMainAgentToRuntime({
                runtime: runtimeContext.runtime,
                agentTemplate: agentTemplates[0],
                runtimeCapabilities,
              })).agent,
            ],
          }
        : await provisionBlueprintAgentsToRuntime({
            runtime: runtimeContext.runtime,
            agentTemplates,
            runtimeCapabilities,
          });
      provisionedAgentsByCallsign = new Map(
        provisioned.agents.map((agent) => [
          agent.callsign.toUpperCase(),
          { runtimeRef: agent.runtimeRef, workspacePath: agent.workspacePath },
        ])
      );
    }

    // Fetch existing company skills for auto-attach
    let companySkills: { id: string; slug: string }[] = [];
    try {
      companySkills = await withRetry(() =>
        db!
          .select({ id: schema.skills.id, slug: schema.skills.slug })
          .from(schema.skills)
          .where(storageCompanyId ? eq(schema.skills.companyId, storageCompanyId) : isNull(schema.skills.companyId))
      );
    } catch {
      // Skills lookup is best-effort
    }
    const skillSlugMap = new Map(companySkills.map((s) => [s.slug, s.id]));

    // Create agents
    const createdAgents: Record<string, { id: string; callsign: string }> = {};

    for (const tmpl of agentTemplates) {
      const adapterConfig: Record<string, unknown> = {};
      if (tmpl.promptTemplate) adapterConfig.promptTemplate = tmpl.promptTemplate;
      if (tmpl.adapterType === "openrouter") {
        adapterConfig.baseUrl = "https://openrouter.ai/api/v1";
      }
      const resolvedModel = resolveBlueprintAgentModelSelection(tmpl, runtimeCapabilities);
      const provisionedAgent = provisionedAgentsByCallsign.get(tmpl.callsign.toUpperCase());
      const runtimeAdapterConfig = runtimeContext.runtime
        ? {
            url: runtimeContext.runtime.httpUrl,
            headers: runtimeContext.runtime.authToken
              ? { Authorization: `Bearer ${runtimeContext.runtime.authToken}` }
              : undefined,
          }
        : null;

      const operatingLayer = buildBlueprintOperatingLayer({
        callsign: tmpl.callsign.toUpperCase(),
        rolePack: tmpl.rolePack,
        modelProfile: resolvedModel.profile,
        fallbackProfiles: resolvedModel.fallbackProfiles,
        curatedSkills: tmpl.curatedSkillMetadata,
        identityRaw: tmpl.identityContent,
        soulRaw: tmpl.soulContent,
        agentsRaw: tmpl.agentsContent,
      });
      const agentValues: typeof schema.agents.$inferInsert = {
        callsign: tmpl.callsign.toUpperCase(),
        name: tmpl.name,
        title: tmpl.title,
        emoji: tmpl.emoji,
        color: tmpl.color,
        role: tmpl.role,
        adapterType: runtimeContext.runtime ? "openclaw_gateway" : tmpl.adapterType,
        model: resolvedModel.primaryModel ?? tmpl.model ?? null,
        adapterConfig: runtimeAdapterConfig ?? adapterConfig,
        workspacePath: provisionedAgent?.workspacePath ?? null,
        runtimeId: runtimeContext.runtime?.id ?? null,
        runtimeRef: provisionedAgent?.runtimeRef ?? null,
        runtimeConfig: { operatingLayer },
        companyId: targetWorkspace.companyId,
        ownerType: effectiveOwnerType,
        ownerUserId: effectiveOwnerUserId,
        ownerCompanyId: effectiveOwnerCompanyId,
        visibility: effectiveVisibility,
        reportsTo: null,
        soulContent: tmpl.soulContent ?? tmpl.promptTemplate ?? null,
      };

      if (mergeSingleAgentBlueprintIntoMain && runtimeMainAgent) {
        const [updated] = await withRetry(() =>
          db!
            .update(schema.agents)
            .set(agentValues)
            .where(eq(schema.agents.id, runtimeMainAgent.id))
            .returning()
        );
        createdAgents[tmpl.callsign.toUpperCase()] = {
          id: updated.id,
          callsign: updated.callsign,
        };
        continue;
      }

      const [created] = await withRetry(() =>
        db!.insert(schema.agents).values(agentValues).returning()
      );

      createdAgents[tmpl.callsign.toUpperCase()] = { id: created.id, callsign: created.callsign };

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
              .where(eq(schema.agents.id, agent.id))
          );
        }
      } else if (runtimeMainAgent) {
        await withRetry(() =>
          db!
            .update(schema.agents)
            .set({ reportsTo: runtimeMainAgent.callsign })
            .where(eq(schema.agents.id, agent.id))
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
              await withRetry(() =>
                db!.insert(schema.agentSkills).values({
                  agentId: agent.id,
                  skillId,
                  enabled: true,
                  config: {},
                })
              );
            } catch {
              // Skill attachment is best-effort
            }
          }
        }
      }
    }

    if (runtimeContext.runtime) {
      await pushSkillToRuntime(runtimeContext.runtime.id);
    }

    // Increment popularity if it's a DB blueprint
    if (!isBuiltIn) {
      try {
        const [current] = await withRetry(() =>
          db!.select({ popularity: schema.teamBlueprints.popularity })
            .from(schema.teamBlueprints)
            .where(eq(schema.teamBlueprints.id, blueprintId))
        );
        if (current) {
          await withRetry(() =>
            db!.update(schema.teamBlueprints)
              .set({ popularity: current.popularity + 1, updatedAt: new Date() })
              .where(eq(schema.teamBlueprints.id, blueprintId))
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
        runtimeProvisioned: Boolean(runtimeContext.runtime),
      },
      { status: 201 }
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
        { error: "One or more agent callsigns already exist. Rename agents before deploying." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to deploy blueprint" }, { status: 500 });
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
      .limit(1)
  );

  const metadata =
    runtime?.metadata && typeof runtime.metadata === "object" && !Array.isArray(runtime.metadata)
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
      eq(schema.companyRuntimes.isPrimary, true)
    );
  }

  return and(
    eq(schema.companyRuntimes.ownerType, "company"),
    or(
      eq(schema.companyRuntimes.ownerCompanyId, workspace.companyId ?? ""),
      eq(schema.companyRuntimes.companyId, workspace.companyId ?? "")
    )!,
    eq(schema.companyRuntimes.isPrimary, true)
  );
}

function readRuntimeDefaultAgentId(metadata: Record<string, unknown> | null): string | null {
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
    (agent) => !params.excludeCallsigns.has(agent.callsign.toUpperCase())
  );
  if (existingAgents.length === 0) return null;

  const defaultRuntimeRef = params.defaultAgentId?.toLowerCase();
  const byRuntimeRef = (runtimeRef: string) =>
    existingAgents.find((agent) => agent.runtimeRef?.toLowerCase() === runtimeRef);

  const mainAgent =
    (defaultRuntimeRef ? byRuntimeRef(defaultRuntimeRef) : null) ??
    byRuntimeRef("main") ??
    existingAgents.find((agent) => agent.callsign.toUpperCase() === "MAIN") ??
    existingAgents.find((agent) => !agent.reportsTo) ??
    existingAgents[0];

  return mainAgent ? { id: mainAgent.id, callsign: mainAgent.callsign } : null;
}

async function assertBlueprintCallsignsAvailable(
  agentTemplates: BlueprintAgentTemplate[],
  opts?: { ignoreAgentId?: string | null }
): Promise<void> {
  const callsigns = agentTemplates.map((agent) => agent.callsign.toUpperCase());
  const existing = await withRetry(() =>
    db!
      .select({ id: schema.agents.id, callsign: schema.agents.callsign })
      .from(schema.agents)
      .where(inArray(schema.agents.callsign, callsigns))
  );

  const taken = new Set(
    existing
      .filter((row) => row.id !== opts?.ignoreAgentId)
      .map((row) => row.callsign.toUpperCase())
  );
  if (callsigns.some((callsign) => taken.has(callsign))) {
    throw new Error("One or more agent callsigns already exist. Rename agents before deploying.");
  }
}
