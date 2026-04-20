import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { validateSkillConfigSecretRefs } from "@/lib/service-secrets";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";
import { resolveRuntimeWorkspace } from "@/lib/workspace";
import { pushSecretsToGateway } from "@/lib/push-secrets-to-gateway";
import { uninstallSkillFromOpenClaw } from "@/lib/uninstall-skill-from-openclaw";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/skills/[id]/agents — returns all agents with assignment status for this skill
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json([]);
  }

  try {
    const { id } = await params;

    // Get all agent_skills rows for this skill
    const assignments = await withRetry(() =>
      db!.select().from(schema.agentSkills).where(eq(schema.agentSkills.skillId, id))
    );

    const result = assignments.map((a) => ({
      agentSkillId: a.id,
      agentId: a.agentId,
      skillId: a.skillId,
      enabled: a.enabled,
      config: a.config ?? {},
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/skills/[id]/agents] GET Error:", err);
    return NextResponse.json([]);
  }
}

// POST /api/skills/[id]/agents — assign or unassign an agent
// Body: { agentId: string, enabled?: boolean, config?: Record<string, unknown> }
// If agent is already assigned, removes the assignment. Otherwise, creates it.
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { agentId, enabled, config } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    if (enabled !== undefined && typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean when provided" }, { status: 400 });
    }

    if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) {
      return NextResponse.json({ error: "config must be an object when provided" }, { status: 400 });
    }

    const [agent] = await withRetry(() =>
      db!
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1)
    );

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const [skill] = await withRetry(() =>
      db!
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.id, id))
        .limit(1)
    );

    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    if (agent.companyId !== skill.companyId) {
      return NextResponse.json({ error: "Agent and skill belong to different companies" }, { status: 400 });
    }

    if (config !== undefined) {
      const workspace = await resolveRuntimeWorkspace({
        ownerType: agent.ownerType,
        ownerUserId: agent.ownerUserId ?? null,
        ownerCompanyId: agent.ownerCompanyId ?? null,
        companyId: agent.companyId ?? null,
      });
      const validation = await validateSkillConfigSecretRefs({ workspaceId: workspace?.id ?? null, companyId: workspace?.companyId ?? agent.companyId ?? null }, config);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    // Check if already assigned
    const existing = await withRetry(() =>
      db!
        .select()
        .from(schema.agentSkills)
        .where(
          and(
            eq(schema.agentSkills.skillId, id),
            eq(schema.agentSkills.agentId, agentId)
          )
        )
    );

    if (existing.length > 0) {
      let uninstall:
        | { ok: boolean; error?: string; warnings?: string[]; removedPaths?: string[]; removedConfigEntry?: boolean }
        | undefined;
      if (agent.companyId) {
        try {
          const result = await uninstallSkillFromOpenClaw({
            skillId: id,
            agentId,
            companyId: agent.companyId,
          });
          uninstall = result.success
            ? {
                ok: true,
                warnings: result.warnings,
                removedPaths: result.removedPaths,
                removedConfigEntry: result.removedConfigEntry,
              }
            : {
                ok: false,
                error: result.errors.join("; ") || "Workspace cleanup failed",
                warnings: result.warnings,
                removedPaths: result.removedPaths,
                removedConfigEntry: result.removedConfigEntry,
              };
        } catch (err) {
          uninstall = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Unassign
      await withRetry(() =>
        db!.delete(schema.agentSkills).where(eq(schema.agentSkills.id, existing[0].id))
      );
      return NextResponse.json({ action: "removed", agentSkillId: existing[0].id, uninstall });
    }

    // Assign
    const [created] = await withRetry(() =>
      db!
        .insert(schema.agentSkills)
        .values({
          agentId,
          skillId: id,
          enabled: enabled ?? true,
          config: config ?? {},
        })
        .returning()
    );

    let sync: { ok: boolean; error?: string } | undefined;
    let secrets: { ok: boolean; error?: string } | undefined;

    if (agent.companyId) {
      try {
        const result = await syncSkillToOpenClaw({
          skillId: id,
          agentId,
          companyId: agent.companyId,
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

    if (agent.runtimeId && agent.companyId) {
      try {
        const result = await pushSecretsToGateway({
          skillId: id,
          agentId,
          companyId: agent.companyId,
        });
        secrets = result.ok
          ? { ok: true }
          : { ok: false, error: result.errors.join("; ") || "Secret push failed" };
      } catch (err) {
        secrets = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return NextResponse.json({ action: "added", ...created, sync, secrets }, { status: 201 });
  } catch (err) {
    console.error("[api/skills/[id]/agents] POST Error:", err);
    return NextResponse.json({ error: "Failed to toggle assignment" }, { status: 500 });
  }
}
