/**
 * Data migration: Create built-in skill records and agent_skills entries
 * based on each agent's existing adapter_type.
 *
 * Usage:
 *   npx tsx scripts/migrate-skills-from-adapter.ts
 *
 * Mapping (adapter_type → built-in skill slug):
 *   claude_local   → claude-code
 *   codex_local    → codex
 *   gemini_local   → gemini-cli
 *   opencode_local → opencode
 *   cursor         → cursor
 *   pi_local       → pi
 *
 * For each agent:
 *   1. Looks up or creates the matching skill in the skills table (scoped to
 *      the agent's companyId).
 *   2. Creates an agent_skills row linking the agent to that skill, copying
 *      relevant adapter_config fields (cwd, command) into skill config.
 *   3. Idempotent — skips if the agent_skills entry already exists.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { BUILT_IN_SKILLS } from "../src/lib/skills/built-in";

// ─── Adapter → Skill slug mapping ──────────────────────────────────

const ADAPTER_TO_SKILL_SLUG: Record<string, string> = {
  claude_local: "claude-code",
  codex_local: "codex",
  gemini_local: "gemini-cli",
  opencode_local: "opencode",
  cursor: "cursor",
  pi_local: "pi",
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL env var is required.");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });

  // ── Fetch all agents with an adapter_type that maps to a skill ────
  const allAgents = await db
    .select({
      id: schema.agents.id,
      callsign: schema.agents.callsign,
      adapterType: schema.agents.adapterType,
      adapterConfig: schema.agents.adapterConfig,
      companyId: schema.agents.companyId,
    })
    .from(schema.agents);

  const eligibleAgents = allAgents.filter(
    (a) => a.adapterType in ADAPTER_TO_SKILL_SLUG && a.companyId
  );

  console.log(
    `Found ${eligibleAgents.length} agent(s) with mappable adapter types (of ${allAgents.length} total).\n`
  );

  if (eligibleAgents.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // ── Pre-fetch existing skills and agent_skills for idempotency ────
  const existingSkills = await db.select().from(schema.skills);
  const existingAgentSkills = await db.select().from(schema.agentSkills);

  // Index: "companyId:slug" → skill record
  const skillIndex = new Map(
    existingSkills.map((s) => [`${s.companyId}:${s.slug}`, s])
  );

  // Index: "agentId:skillId" → true
  const agentSkillIndex = new Set(
    existingAgentSkills.map((as) => `${as.agentId}:${as.skillId}`)
  );

  let skillsCreated = 0;
  let linksCreated = 0;
  let skipped = 0;

  for (const agent of eligibleAgents) {
    const slug = ADAPTER_TO_SKILL_SLUG[agent.adapterType];
    const builtIn = BUILT_IN_SKILLS.find((s) => s.slug === slug);
    if (!builtIn) {
      console.log(`  SKIP  ${agent.callsign} — no built-in definition for slug "${slug}"`);
      skipped++;
      continue;
    }

    const companyId = agent.companyId!;
    const skillKey = `${companyId}:${slug}`;

    // ── Ensure skill record exists for this company ─────────────
    let skill = skillIndex.get(skillKey);
    if (!skill) {
      const [created] = await db
        .insert(schema.skills)
        .values({
          companyId,
          name: builtIn.name,
          slug: builtIn.slug,
          description: builtIn.description,
          source: "built-in",
          metadata: {
            category: builtIn.category,
            runtime: builtIn.runtime,
            command: builtIn.command ?? null,
            icon: builtIn.icon,
            compatibleProviders: builtIn.compatibleProviders ?? null,
          },
          installed: true,
        })
        .returning();

      skill = created;
      skillIndex.set(skillKey, skill);
      skillsCreated++;
      console.log(`  CREATE SKILL  "${builtIn.name}" for company ${companyId}`);
    }

    // ── Check idempotency — skip if link already exists ─────────
    const linkKey = `${agent.id}:${skill.id}`;
    if (agentSkillIndex.has(linkKey)) {
      console.log(`  SKIP  ${agent.callsign} — already linked to "${builtIn.name}"`);
      skipped++;
      continue;
    }

    // ── Build skill config from adapter_config ──────────────────
    const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    const skillConfig: Record<string, unknown> = {};
    if (adapterCfg.workspacePath) skillConfig.cwd = adapterCfg.workspacePath;
    if (adapterCfg.command) skillConfig.command = adapterCfg.command;

    // ── Create agent_skills link ────────────────────────────────
    await db.insert(schema.agentSkills).values({
      agentId: agent.id,
      skillId: skill.id,
      enabled: true,
      config: skillConfig,
    });

    agentSkillIndex.add(linkKey);
    linksCreated++;
    console.log(
      `  LINK  ${agent.callsign} → "${builtIn.name}"` +
        (Object.keys(skillConfig).length > 0
          ? ` (config: ${JSON.stringify(skillConfig)})`
          : "")
    );
  }

  console.log(
    `\nDone. Skills created: ${skillsCreated}, Links created: ${linksCreated}, Skipped: ${skipped}`
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
