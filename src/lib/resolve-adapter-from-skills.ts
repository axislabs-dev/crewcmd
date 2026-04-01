/**
 * Resolves the adapter type for an agent based on its installed CLI skills.
 *
 * When an agent has CLI skills installed (claude-code, codex, etc.), the
 * primary CLI skill determines the execution adapter. Falls back to the
 * agent's adapter_type if no CLI skills are installed.
 */

import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

/** Maps built-in skill slugs back to adapter type keys */
const SKILL_SLUG_TO_ADAPTER: Record<string, string> = {
  "claude-code": "claude_local",
  codex: "codex_local",
  "gemini-cli": "gemini_local",
  opencode: "opencode_local",
  cursor: "cursor",
  pi: "pi_local",
};

/** CLI skill slugs in priority order (first match wins) */
const CLI_SKILL_PRIORITY = [
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "cursor",
  "pi",
];

export interface SkillAdapterResolution {
  /** The resolved adapter type to use for execution */
  adapterType: string;
  /** Whether this was resolved from a skill (true) or fell back to adapter_type (false) */
  fromSkill: boolean;
  /** The skill slug that was used, if any */
  skillSlug?: string;
}

/**
 * Given an agent ID and its fallback adapter_type, resolve the actual
 * adapter type to use for execution by checking installed CLI skills.
 *
 * Priority:
 * 1. Enabled CLI skills on the agent (in priority order)
 * 2. The agent's adapter_type field (fallback)
 */
export async function resolveAdapterFromSkills(
  agentId: string,
  fallbackAdapterType: string
): Promise<SkillAdapterResolution> {
  if (!db) {
    return { adapterType: fallbackAdapterType, fromSkill: false };
  }

  try {
    // Fetch the agent's enabled skills with their skill details
    const agentSkillRows = await withRetry(() =>
      db!
        .select({
          enabled: schema.agentSkills.enabled,
          skillId: schema.agentSkills.skillId,
        })
        .from(schema.agentSkills)
        .where(eq(schema.agentSkills.agentId, agentId))
    );

    const enabledSkillIds = agentSkillRows
      .filter((r) => r.enabled)
      .map((r) => r.skillId);

    if (enabledSkillIds.length === 0) {
      return { adapterType: fallbackAdapterType, fromSkill: false };
    }

    // Fetch skill details for enabled skills
    const allSkills = await withRetry(() =>
      db!.select().from(schema.skills)
    );

    const enabledSlugs = new Set(
      allSkills
        .filter((s) => enabledSkillIds.includes(s.id))
        .map((s) => s.slug)
    );

    // Find the highest-priority CLI skill that's installed
    for (const slug of CLI_SKILL_PRIORITY) {
      if (enabledSlugs.has(slug) && SKILL_SLUG_TO_ADAPTER[slug]) {
        return {
          adapterType: SKILL_SLUG_TO_ADAPTER[slug],
          fromSkill: true,
          skillSlug: slug,
        };
      }
    }

    // No CLI skills found — fall back
    return { adapterType: fallbackAdapterType, fromSkill: false };
  } catch {
    // On any DB error, fall back gracefully
    return { adapterType: fallbackAdapterType, fromSkill: false };
  }
}
