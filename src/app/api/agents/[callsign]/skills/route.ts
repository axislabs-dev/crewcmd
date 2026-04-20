import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateSkillConfigSecretRefs } from "@/lib/service-secrets";
import { pushSecretsToGateway } from "@/lib/push-secrets-to-gateway";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";
import { resolveRuntimeWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

async function findAgent(callsign: string) {
  const dbAgents = await withRetry(() => db!.select().from(schema.agents));
  return dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
}

async function findSkill(skillId: string) {
  const [skill] = await withRetry(() =>
    db!
      .select({
        id: schema.skills.id,
        workspaceId: schema.skills.workspaceId,
        companyId: schema.skills.companyId,
      })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId))
      .limit(1)
  );

  return skill ?? null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const { callsign } = await params;
    const agent = await findAgent(callsign);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const rows = await withRetry(() =>
      db!.select().from(schema.agentSkills).where(eq(schema.agentSkills.agentId, agent.id))
    );

    // Enrich with skill details
    const skillIds = rows.map((r) => r.skillId);
    if (skillIds.length === 0) {
      return NextResponse.json([]);
    }

    const allSkills = await withRetry(() => db!.select().from(schema.skills));
    const skillMap = new Map(allSkills.map((s) => [s.id, s]));

    const enriched = rows.map((r) => ({
      ...r,
      config: r.config ?? {},
      skill: skillMap.get(r.skillId) || null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[api/agents/[callsign]/skills] GET Error:", err);
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign } = await params;
    const agent = await findAgent(callsign);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json();
    const { skillId, enabled, config } = body;

    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }

    const skill = await findSkill(skillId);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    if (enabled !== undefined && typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean when provided" }, { status: 400 });
    }

    if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) {
      return NextResponse.json({ error: "config must be an object when provided" }, { status: 400 });
    }

    if (config !== undefined) {
      const runtimeWorkspace = await resolveRuntimeWorkspace({
        ownerType: agent.ownerType,
        ownerUserId: agent.ownerUserId ?? null,
        ownerCompanyId: agent.ownerCompanyId ?? null,
        companyId: agent.companyId ?? null,
      });
      const validation = await validateSkillConfigSecretRefs({
        workspaceId: skill.workspaceId ?? runtimeWorkspace?.id ?? null,
        companyId: skill.companyId ?? runtimeWorkspace?.companyId ?? agent.companyId ?? null,
      }, config);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    const [created] = await withRetry(() =>
      db!.insert(schema.agentSkills).values({
        agentId: agent.id,
        skillId,
        enabled: enabled ?? true,
        config: config ?? {},
      }).returning()
    );

    let sync: { ok: boolean; error?: string } | undefined;
    let secrets: { ok: boolean; error?: string } | undefined;
    const syncWorkspaceId = skill.workspaceId ?? null;
    const syncCompanyId = skill.companyId ?? null;

    if (syncWorkspaceId || syncCompanyId) {
      try {
        const result = await syncSkillToOpenClaw({
          skillId,
          agentId: agent.id,
          companyId: syncCompanyId,
          workspaceId: syncWorkspaceId,
        });
        sync = result.success
          ? { ok: true }
          : { ok: false, error: result.errors.join("; ") || "Sync failed" };
      } catch (err) {
        sync = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Push secrets to gateway after the runtime files/config are in place.
    if ((syncWorkspaceId || syncCompanyId) && agent.runtimeId) {
      try {
        const result = await pushSecretsToGateway({
          skillId,
          agentId: agent.id,
          companyId: syncCompanyId,
          workspaceId: syncWorkspaceId,
        });
        secrets = result.ok
          ? { ok: true }
          : { ok: false, error: result.errors.join("; ") || "Secret push failed" };
      } catch (err) {
        console.warn(`[api/agents/skills] Secret push failed for ${agent.callsign}:`, err);
        secrets = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return NextResponse.json({ ...created, sync, secrets }, { status: 201 });
  } catch (err) {
    console.error("[api/agents/[callsign]/skills] POST Error:", err);
    return NextResponse.json({ error: "Failed to attach skill" }, { status: 500 });
  }
}
