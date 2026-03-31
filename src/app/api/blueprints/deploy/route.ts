import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { BUILT_IN_BLUEPRINTS } from "@/lib/blueprints-data";
import type { BlueprintTemplate, BlueprintAgentTemplate } from "@/db/schema";

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

      const [created] = await withRetry(() =>
        db!.insert(schema.agents).values({
          callsign: tmpl.callsign.toUpperCase(),
          name: tmpl.name,
          title: tmpl.title,
          emoji: tmpl.emoji,
          color: tmpl.color,
          role: tmpl.role,
          adapterType: tmpl.adapterType,
          model: tmpl.model ?? null,
          adapterConfig,
          runtimeConfig: {},
          companyId,
          reportsTo: null, // Set in second pass
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
    return NextResponse.json({ success: true, agents, count: agents.length }, { status: 201 });
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
