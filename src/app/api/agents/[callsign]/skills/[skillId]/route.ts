import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateSkillConfigSecretRefs } from "@/lib/service-secrets";
import { pushSecretsToGateway } from "@/lib/push-secrets-to-gateway";
import { syncSkillToOpenClaw } from "@/lib/sync-skill-to-openclaw";
import { resolveRuntimeWorkspace } from "@/lib/workspace";
import { uninstallSkillFromOpenClaw } from "@/lib/uninstall-skill-from-openclaw";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string; skillId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign, skillId } = await params;

    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json();
    const { enabled, config } = body;

    if (enabled === undefined && config === undefined) {
      return NextResponse.json({ error: "enabled or config is required" }, { status: 400 });
    }

    if (enabled !== undefined && typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean when provided" }, { status: 400 });
    }

    if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) {
      return NextResponse.json({ error: "config must be an object when provided" }, { status: 400 });
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

    const [row] = await withRetry(() =>
      db!
        .select()
        .from(schema.agentSkills)
        .where(
          and(
            eq(schema.agentSkills.agentId, agent.id),
            eq(schema.agentSkills.skillId, skillId)
          )
        )
    );

    if (!row) {
      return NextResponse.json({ error: "Skill not assigned to this agent" }, { status: 404 });
    }

    const updates: { enabled?: boolean; config?: Record<string, unknown> } = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (config !== undefined) updates.config = config as Record<string, unknown>;

    const [updated] = await withRetry(() =>
      db!
        .update(schema.agentSkills)
        .set(updates)
        .where(eq(schema.agentSkills.id, row.id))
        .returning()
    );

    let sync: { ok: boolean; error?: string } | undefined;
    let secrets: { ok: boolean; error?: string } | undefined;

    if (agent.companyId) {
      try {
        const result = await syncSkillToOpenClaw({
          skillId,
          agentId: agent.id,
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

    if (agent.companyId && agent.runtimeId) {
      try {
        const result = await pushSecretsToGateway({
          skillId,
          agentId: agent.id,
          companyId: agent.companyId,
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

    return NextResponse.json({ ...updated, sync, secrets });
  } catch (err) {
    console.error("[api/agents/[callsign]/skills/[skillId]] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update skill" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign, skillId } = await params;

    // Find agent by callsign
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    let uninstall:
      | { ok: boolean; error?: string; warnings?: string[]; removedPaths?: string[]; removedConfigEntry?: boolean }
      | undefined;
    if (agent.companyId) {
      try {
        const result = await uninstallSkillFromOpenClaw({
          skillId,
          agentId: agent.id,
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

    await withRetry(() =>
      db!.delete(schema.agentSkills).where(
        and(
          eq(schema.agentSkills.agentId, agent.id),
          eq(schema.agentSkills.skillId, skillId)
        )
      )
    );

    return NextResponse.json({ ok: true, uninstall });
  } catch (err) {
    console.error("[api/agents/[callsign]/skills/[skillId]] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to detach skill" }, { status: 500 });
  }
}
