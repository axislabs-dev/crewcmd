import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";
import type { BlueprintTemplate, BlueprintAgentTemplate } from "@/db/schema";
import { buildBlueprintOperatingLayer } from "@/lib/operating-layer";
import { resolveBlueprintAgentModelSelection } from "@/lib/model-profiles";
import type { RuntimeCapabilitySnapshot } from "@/lib/runtime-capabilities";
import { provisionBlueprintAgentsToRuntime } from "@/lib/blueprint-runtime-provisioning";
import { pushSkillToRuntime } from "@/lib/push-skill-to-runtime";

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
    const { blueprintId, companyId, customize } = body as {
      blueprintId: string;
      companyId: string;
      customize?: { agents?: Partial<BlueprintAgentTemplate>[] };
    };

    if (!blueprintId || !companyId) {
      return NextResponse.json(
        { error: "blueprintId and companyId are required" },
        { status: 400 }
      );
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
    const runtimeContext = await loadPrimaryRuntimeContext(companyId);
    const runtimeCapabilities = runtimeContext.capabilities;

    await assertBlueprintCallsignsAvailable(agentTemplates);

    let provisionedAgentsByCallsign = new Map<string, { runtimeRef: string; workspacePath: string | null }>();
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
          .where(eq(schema.skills.companyId, companyId))
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

      const [created] = await withRetry(() =>
        db!.insert(schema.agents).values({
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
          runtimeConfig: {
            operatingLayer: buildBlueprintOperatingLayer({
              callsign: tmpl.callsign.toUpperCase(),
              rolePack: tmpl.rolePack,
              modelProfile: resolvedModel.profile,
              fallbackProfiles: resolvedModel.fallbackProfiles,
              curatedSkills: tmpl.curatedSkillMetadata,
              identityRaw: tmpl.identityContent,
              soulRaw: tmpl.soulContent,
              agentsRaw: tmpl.agentsContent,
            }),
          },
          companyId,
          reportsTo: null, // Set in second pass
          soulContent: tmpl.soulContent ?? tmpl.promptTemplate ?? null,
        }).returning()
      );

      createdAgents[tmpl.callsign.toUpperCase()] = { id: created.id, callsign: created.callsign };
    }

    // Set up reportsTo relationships (second pass)
    for (const tmpl of agentTemplates) {
      if (tmpl.reportsTo) {
        const agent = createdAgents[tmpl.callsign.toUpperCase()];
        const manager = createdAgents[tmpl.reportsTo.toUpperCase()];
        if (agent && manager) {
          await withRetry(() =>
            db!
              .update(schema.agents)
              .set({ reportsTo: manager.callsign })
              .where(eq(schema.agents.id, agent.id))
          );
        }
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
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "One or more agent callsigns already exist. Rename agents before deploying." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to deploy blueprint" }, { status: 500 });
  }
}

async function loadPrimaryRuntimeContext(companyId: string): Promise<{
  runtime: {
    id: string;
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
        gatewayUrl: schema.companyRuntimes.gatewayUrl,
        httpUrl: schema.companyRuntimes.httpUrl,
        authToken: schema.companyRuntimes.authToken,
        metadata: schema.companyRuntimes.metadata,
      })
      .from(schema.companyRuntimes)
      .where(
        and(
          eq(schema.companyRuntimes.companyId, companyId),
          eq(schema.companyRuntimes.ownerType, "company"),
          eq(schema.companyRuntimes.isPrimary, true)
        )
      )
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
          gatewayUrl: runtime.gatewayUrl,
          httpUrl: runtime.httpUrl,
          authToken: runtime.authToken,
          metadata,
        }
      : null,
    capabilities: snapshot as RuntimeCapabilitySnapshot,
  };
}

async function assertBlueprintCallsignsAvailable(
  agentTemplates: BlueprintAgentTemplate[]
): Promise<void> {
  const callsigns = agentTemplates.map((agent) => agent.callsign.toUpperCase());
  const existing = await withRetry(() =>
    db!
      .select({ callsign: schema.agents.callsign })
      .from(schema.agents)
      .where(inArray(schema.agents.callsign, callsigns))
  );

  const taken = new Set(existing.map((row) => row.callsign.toUpperCase()));
  if (callsigns.some((callsign) => taken.has(callsign))) {
    throw new Error("One or more agent callsigns already exist. Rename agents before deploying.");
  }
}
