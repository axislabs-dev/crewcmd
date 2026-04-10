/**
 * Skill sync from CrewCMD DB to the local OpenClaw workspace (same-machine).
 *
 * Phase 1 only: assumes CrewCMD and OpenClaw share the same host, so we
 * write files via `node:fs/promises`.
 *
 * Public entry-point:
 *   syncSkillToOpenClaw({ skillId, agentId, companyId })
 */

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, withRetry } from "@/db";
import { agentSkills, agents, companyRuntimes, skills } from "@/db/schema";

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncSkillOptions {
  skillId: string;
  agentId: string;
  companyId: string;
  dryRun?: boolean;
}

export interface SyncResult {
  success: boolean;
  skillPath: string;
  configPath: string;
  checksum: string;
  errors: string[];
  syncedAt: string;
}

interface SkillData {
  skill: typeof skills.$inferSelect;
  agent: typeof agents.$inferSelect;
  assignment: typeof agentSkills.$inferSelect;
  runtime: typeof companyRuntimes.$inferSelect | null;
}

// ─── Constants ──────────────────────────────────────────────────────

const META_VERSION = "0.1.0";

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Sync a single CrewCMD skill to a specific agent's OpenClaw workspace.
 *
 * 1. Reads skill / agent / assignment from DB
 * 2. Generates SKILL.md with AgentSkills frontmatter
 * 3. Writes atomically to `~/.openclaw/workspace-<runtimeRef>/skills/<slug>/SKILL.md`
 * 4. Creates `.crewcmd-meta.json` alongside
 * 5. Merges runtime config into `~/.openclaw/openclaw.json`
 * 6. Verifies the write via SHA-256
 */
export async function syncSkillToOpenClaw(
  opts: SyncSkillOptions
): Promise<SyncResult> {
  const errors: string[] = [];
  const now = new Date().toISOString();

  let skillData: SkillData;
  try {
    skillData = await loadSkillData(opts.skillId, opts.agentId, opts.companyId);
  } catch (err) {
    return makeFailure(
      "Failed to load skill data from database",
      err instanceof Error ? err.message : String(err)
    );
  }

  const slug = skillData.skill.slug;
  const runtimeRef =
    skillData.agent.runtimeRef ?? skillData.agent.id;
  const skillsDir = openclawSkillsDir(runtimeRef, slug);
  const skillMdPath = join(skillsDir, "SKILL.md");
  const metaPath = join(skillsDir, ".crewcmd-meta.json");
  const openclawJsonPath = join(homedir(), ".openclaw", "openclaw.json");

  // ── Generate SKILL.md content ────────────────────────────────
  const skillMdContent = generateSkillMd(skillData.skill);
  const checksum = "sha256:" + sha256(skillMdContent);

  // ── Retrieve previous checksum for .crewcmd-meta.json ────────
  let previousChecksum: string | undefined;
  try {
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as Record<string, unknown>;
    previousChecksum = meta.checksum as string | undefined;
  } catch {
    // no previous sync — first time
  }

  // ── Dry-run shortcut ─────────────────────────────────────────
  if (opts.dryRun) {
    return {
      success: true,
      skillPath: skillMdPath,
      configPath: openclawJsonPath,
      checksum,
      errors: [],
      syncedAt: now,
    };
  }

  // ── Write SKILL.md (atomic) ──────────────────────────────────
  try {
    await atomicWrite(skillMdPath, skillMdContent);
  } catch (err) {
    errors.push(`Failed to write SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – SKILL.md", checksum, skillMdPath, openclawJsonPath, errors, now);
  }

  // ── Write .crewcmd-meta.json (atomic) ────────────────────────
  const metaContent = JSON.stringify(
    {
      source: "crewcmd",
      skillId: opts.skillId,
      version: META_VERSION,
      syncedAt: now,
      syncedBy: opts.agentId,
      sourceType: (skillData.skill.metadata as Record<string, unknown> | null)?.["sourceType"] ?? skillData.skill.source,
      previousChecksum: previousChecksum ?? null,
      checksum,
    },
    null,
    2
  );

  try {
    await atomicWrite(metaPath, metaContent);
  } catch (err) {
    errors.push(`Failed to write .crewcmd-meta.json: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – metadata", checksum, skillMdPath, openclawJsonPath, errors, now);
  }

  // ── Merge openclaw.json ──────────────────────────────────────
  const assignmentConfig =
    typeof skillData.assignment.config === "object" && skillData.assignment.config !== null
      ? skillData.assignment.config
      : {};

  const skillEntry = buildSkillEntry(slug, skillData.skill, skillData.assignment.enabled, assignmentConfig);

  try {
    await mergeOpenclawJson(openclawJsonPath, slug, skillEntry);
  } catch (err) {
    errors.push(`Failed to merge openclaw.json: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – openclaw.json", checksum, skillMdPath, openclawJsonPath, errors, now);
  }

  // ── Verify write ─────────────────────────────────────────────
  try {
    const written = await readFile(skillMdPath, "utf-8");
    const actualChecksum = "sha256:" + sha256(written);
    if (actualChecksum !== checksum) {
      errors.push(
        `Checksum mismatch after write: expected ${checksum}, got ${actualChecksum}`
      );
    }
  } catch (err) {
    errors.push(`Failed to verify written file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) {
    return {
      success: false,
      skillPath: skillMdPath,
      configPath: openclawJsonPath,
      checksum,
      errors,
      syncedAt: now,
    };
  }

  return {
    success: true,
    skillPath: skillMdPath,
    configPath: openclawJsonPath,
    checksum,
    errors: [],
    syncedAt: now,
  };
}

// ─── DB Loading ─────────────────────────────────────────────────────

async function loadSkillData(
  skillId: string,
  agentId: string,
  companyId: string
): Promise<SkillData> {
  if (!db) throw new Error("Database not initialized");

  // Load agent — verify it belongs to this company
  const [agentRows] = await withRetry(() =>
    db!
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .limit(1)
  );

  if (!agentRows) {
    throw new Error(`Agent ${agentId} not found for company ${companyId}`);
  }

  // Load skill
  const [skillRows] = await withRetry(() =>
    db!
      .select()
      .from(skills)
      .where(and(eq(skills.id, skillId), eq(skills.companyId, companyId)))
      .limit(1)
  );

  if (!skillRows) {
    throw new Error(`Skill ${skillId} not found for company ${companyId}`);
  }

  // Load agent-skill assignment
  const [assignment] = await withRetry(() =>
    db!
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, skillId)))
      .limit(1)
  );

  if (!assignment) {
    throw new Error(`Skill ${skillId} is not assigned to agent ${agentId}`);
  }

  // Load runtime info (same-machine: we need it only for logging)
  let runtime: typeof companyRuntimes.$inferSelect | null = null;
  if (agentRows.runtimeId) {
    const runtimeId = agentRows.runtimeId;
    const [rt] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(eq(companyRuntimes.id, runtimeId))
        .limit(1)
    );
    runtime = rt ?? null;
  }

  return { skill: skillRows, agent: agentRows, assignment, runtime };
}

// ─── SKILL.md Generation ────────────────────────────────────────────

function generateSkillMd(skill: typeof skills.$inferSelect): string {
  const slug = skill.slug;
  const description = skill.description ?? "";
  const content = skill.content ?? "";

  // Derive env requirements from metadata
  const openclawMeta = extractOpenclawMetadata(skill.metadata, slug);

  const frontmatter = [
    "---",
    `name: ${slug}`,
    `description: ${description}`,
    `metadata: ${JSON.stringify(openclawMeta)}`,
    "---",
    "",
  ].join("\n");

  return frontmatter + content;
}

function extractOpenclawMetadata(
  metadata: Record<string, unknown> | null | undefined,
  slug: string
): Record<string, unknown> {
  let envVars: string[] = [];
  let primaryEnv: string | undefined;

  if (metadata) {
    const openclaw = metadata.openclaw as Record<string, unknown> | undefined;
    if (openclaw) {
      const requires = openclaw.requires as Record<string, unknown> | undefined;
      if (requires) {
        const envRaw = requires.env;
        if (Array.isArray(envRaw)) {
          envVars = envRaw.filter(
            (v: unknown): v is string => typeof v === "string"
          );
        }
      }
    }
    if (openclaw && typeof openclaw.primaryEnv === "string") {
      primaryEnv = openclaw.primaryEnv as string;
    }
  }

  // Fallback: derive from slug
  if (envVars.length === 0) {
    const derived = slug.toUpperCase().replace(/[^A-Z0-9_-]/g, "") + "_API_KEY";
    envVars = [derived];
  }

  return {
    openclaw: {
      requires: { env: envVars },
      primaryEnv: primaryEnv ?? envVars[0],
    },
  };
}

// ─── Environment Variable Derivation ────────────────────────────────

/**
 * Map a slug to a conventional env var name used as the primary key.
 * E.g. "evercontent" → "EVERCONTENT_API_KEY"
 */
export function derivePrimaryEnvVar(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9_-]/g, "") + "_API_KEY";
}

// ─── Skill Entry (openclaw.json) ───────────────────────────────────

interface OpenClawSkillEntry {
  enabled: boolean;
  env: Record<string, string>;
  config: Record<string, unknown>;
}

function buildSkillEntry(
  slug: string,
  skill: typeof skills.$inferSelect,
  enabled: boolean,
  assignmentConfig: Record<string, unknown>
): OpenClawSkillEntry {
  const primaryEnv = derivePrimaryEnvVar(slug);

  // Build env map: any secretRef in the assignment config is resolved to an env var.
  // For Phase 1 we only set the primary key as a placeholder — actual secret values
  // are injected by the caller (resolve-secrets.ts) which can populate the env map.
  const env: Record<string, string> = {
    [primaryEnv]: "$(resolve-from-vault)",
  };

  return {
    enabled,
    env,
    config: assignmentConfig,
  };
}

// ─── Filesystem Operations ──────────────────────────────────────────

function openclawSkillsDir(runtimeRef: string, slug: string): string {
  return join(homedir(), ".openclaw", `workspace-${runtimeRef}`, "skills", slug);
}

/**
 * Atomic write: write content to a `.tmp` file, then rename into place.
 * Creates intermediate directories as needed.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = join(filePath, "..");
  await mkdir(dir, { recursive: true });

  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

// ─── openclaw.json Merge ───────────────────────────────────────────

async function mergeOpenclawJson(
  configPath: string,
  slug: string,
  entry: OpenClawSkillEntry
): Promise<void> {
  let config: Record<string, unknown>;

  try {
    const raw = await readFile(configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    config = {};
  }

  // Ensure the skills.entries path exists
  const topLevel = config.skills as Record<string, unknown> | undefined;
  if (!topLevel || typeof topLevel !== "object") {
    config.skills = {};
  }

  const skillsObj = config.skills as Record<string, unknown>;
  const entries = skillsObj.entries as Record<string, unknown> | undefined;
  if (!entries || typeof entries !== "object") {
    skillsObj.entries = {};
  }

  // Deep merge: existing entry → merge new fields, overwrite top-level keys
  const existingEntry = (skillsObj.entries as Record<string, unknown>)[slug] as
    | Record<string, unknown>
    | undefined;

  if (existingEntry) {
    // Merge nested objects, overwrite scalars
    existingEntry.enabled = entry.enabled;

    // Merge env: add new keys, keep existing
    const existingEnv = existingEntry.env as Record<string, unknown> | undefined;
    const mergedEnv: Record<string, string> = {
      ...((typeof existingEnv === "object" && existingEnv !== null ? existingEnv : {}) as Record<string, string>),
      ...(entry.env as Record<string, string>),
    };
    existingEntry.env = mergedEnv;

    // Deep merge config
    const existingConfig =
      existingEntry.config as Record<string, unknown> | undefined;
    existingEntry.config = deepMerge(
      existingConfig ?? {},
      entry.config
    );
  } else {
    (skillsObj.entries as Record<string, unknown>)[slug] = entry;
  }

  await atomicWrite(configPath, JSON.stringify(config, null, 2));
}

/**
 * Shallow deep-merge: top-level keys from `b` overwrite `a`; objects are
 * recursively merged, arrays and primitives are replaced.
 */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a };

  for (const [key, value] of Object.entries(b)) {
    const existing = result[key];
    if (
      isPlainObject(existing) &&
      isPlainObject(value)
    ) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ─── Helpers ────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function makeFailure(
  error: string,
  checksumOrEmpty?: string,
  skillPath = "",
  configPath = "",
  errors: string[] = [],
  syncedAt = new Date().toISOString()
): SyncResult {
  return {
    success: false,
    skillPath,
    configPath,
    checksum: checksumOrEmpty ?? "",
    errors: [error, ...errors],
    syncedAt,
  };
}
