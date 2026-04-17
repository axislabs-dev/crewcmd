/**
 * Push the CrewCmd Management skill to all imported agents on a runtime
 * using the same shared-skill sync path as other OpenClaw-native skills.
 *
 * Flow:
 * 1. Upsert the system skill record in CrewCmd
 * 2. Upsert agent skill assignments with runtime-specific config
 * 3. Sync each assignment through syncSkillToOpenClaw(), which writes to
 *    the shared OpenClaw workspace skill root, updates skills.entries,
 *    and patches the per-agent allowlist.
 */

import { db, withRetry } from "@/db";
import { companyRuntimes, skills, agentSkills, agents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateCrewCmdSkill } from "./crewcmd-skill-template";
import { detectCallbackUrl } from "./detect-callback-url";
import { CREWCMD_MANAGEMENT_SKILL_METADATA } from "./skills/crewcmd-management";
import { syncSkillToOpenClaw } from "./sync-skill-to-openclaw";

const SYSTEM_SKILL_SLUG = "crewcmd-management";
const SYSTEM_SKILL_NAME = "CrewCmd Management";

export async function pushSkillToRuntime(runtimeId: string): Promise<void> {
  if (!db) throw new Error("Database not available");

  // Load runtime
  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, runtimeId))
  );
  if (!runtime) throw new Error(`Runtime ${runtimeId} not found`);

  // Detect callback URL based on gateway network
  const baseUrl = detectCallbackUrl(runtime.gatewayUrl);

  // Generate the SKILL.md content
  // Auth token is NOT embedded — agents read $HEARTBEAT_SECRET from their environment at runtime
  const skillContent = generateCrewCmdSkill({
    baseUrl,
    companyId: runtime.companyId,
  });

  const runtimeAgents = await withRetry(() =>
    db!.select().from(agents).where(eq(agents.runtimeId, runtimeId))
  );

  // Create or update the system skill record in DB
  const skillRecord = await upsertSystemSkill(
    runtime.companyId,
    skillContent
  );

  // Link skill to all agents on this runtime
  await linkSkillToAgents({
    skillId: skillRecord.id,
    runtimeAgents,
    baseUrl,
    companyId: runtime.companyId,
  });

  for (const agent of runtimeAgents) {
    try {
      await syncSkillToOpenClaw({
        skillId: skillRecord.id,
        agentId: agent.id,
        companyId: runtime.companyId,
      });
    } catch (err) {
      console.warn(
        `[push-skill] Failed to sync CrewCmd management skill for ${agent.callsign}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  console.log(
    `[push-skill] Pushed CrewCmd skill to runtime ${runtimeId}: ${runtimeAgents.length} agents, baseUrl=${baseUrl}`
  );
}

async function upsertSystemSkill(
  companyId: string,
  content: string
): Promise<{ id: string }> {
  if (!db) throw new Error("Database not available");

  const metadata = {
    ...CREWCMD_MANAGEMENT_SKILL_METADATA,
    configExample: {
      ...CREWCMD_MANAGEMENT_SKILL_METADATA.configExample,
      companyId,
    },
  };

  // Check if system skill already exists for this company
  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.companyId, companyId),
          eq(skills.slug, SYSTEM_SKILL_SLUG),
          eq(skills.source, "system")
        )
      )
  );

  if (existing) {
    // Update content
    await withRetry(() =>
      db!
        .update(skills)
        .set({ content, metadata, updatedAt: new Date() })
        .where(eq(skills.id, existing.id))
    );
    return { id: existing.id };
  }

  // Create new
  const [created] = await withRetry(() =>
    db!
      .insert(skills)
      .values({
        companyId,
        name: SYSTEM_SKILL_NAME,
        slug: SYSTEM_SKILL_SLUG,
        description:
          "Full workspace management — tasks, projects, agents, inbox, blueprints, budgets, docs, org chart, and activity.",
        source: "system",
        content,
        metadata,
        installed: true,
      })
      .returning({ id: skills.id })
  );

  return created;
}

async function linkSkillToAgents(params: {
  skillId: string;
  runtimeAgents: (typeof agents.$inferSelect)[];
  baseUrl: string;
  companyId: string;
}): Promise<void> {
  if (!db || params.runtimeAgents.length === 0) return;

  const assignmentConfig = {
    baseUrl: params.baseUrl,
    companyId: params.companyId,
  };

  for (const agent of params.runtimeAgents) {
    // Check if already linked
    const [existing] = await withRetry(() =>
      db!
        .select()
        .from(agentSkills)
        .where(
          and(eq(agentSkills.agentId, agent.id), eq(agentSkills.skillId, params.skillId))
        )
    );

    if (!existing) {
      await withRetry(() =>
        db!.insert(agentSkills).values({
          agentId: agent.id,
          skillId: params.skillId,
          enabled: true,
          config: assignmentConfig,
        })
      );
      continue;
    }

    await withRetry(() =>
      db!
        .update(agentSkills)
        .set({
          enabled: true,
          config: assignmentConfig,
        })
        .where(eq(agentSkills.id, existing.id))
    );
  }
}
