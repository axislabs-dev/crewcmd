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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, withRetry } from "@/db";
import { agentSkills, agents, companyRuntimes, skills } from "@/db/schema";
import { collectSecretRefNames, resolveSecretRef } from "./service-secrets";
import { getHeartbeatSecret } from "./heartbeat-secret";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { addSkillToGatewayAgentAllowlist } from "./openclaw-gateway-skill-assignment";
import {
  defaultOpenClawWorkspaceRoot,
  resolveOpenClawWorkspaceRoot,
} from "./openclaw-workspace-resolver";

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
 * Sync a single CrewCMD skill into OpenClaw's shared workspace skill root
 * and update the target agent's explicit skill allowlist when present.
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
  const assignmentConfig =
    typeof skillData.assignment.config === "object" && skillData.assignment.config !== null
      ? skillData.assignment.config
      : {};

  const skillMdContent = generateSkillMd(skillData.skill);
  const checksum = "sha256:" + sha256(skillMdContent);
  const metaContent = JSON.stringify(
    {
      source: "crewcmd",
      skillId: opts.skillId,
      version: META_VERSION,
      syncedAt: now,
      syncedBy: opts.agentId,
      sourceType: (skillData.skill.metadata as Record<string, unknown> | null)?.["sourceType"] ?? skillData.skill.source,
      previousChecksum: null,
      checksum,
    },
    null,
    2
  );
  const resolvedEnv = await resolveSkillEnvVars(
    opts.companyId,
    slug,
    skillData.skill.metadata,
    assignmentConfig as Record<string, unknown>
  );
  const sharedWorkspaceRoot =
    await resolveOpenClawWorkspaceRoot({
    runtimeRef,
    workspacePath: skillData.agent.workspacePath ?? null,
    }) ?? defaultOpenClawWorkspaceRoot();
  const skillsDir = openclawSkillsDir({ workspaceRoot: sharedWorkspaceRoot, slug });
  const skillMdPath = join(skillsDir, "SKILL.md");
  const openclawJsonPath = join(homedir(), ".openclaw", "openclaw.json");

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

  return syncSkillViaFilesystem({
    runtimeRef,
    workspaceRoot: sharedWorkspaceRoot,
    slug,
    skill: skillData.skill,
    assignmentConfig: assignmentConfig as Record<string, unknown>,
    enabled: skillData.assignment.enabled,
    resolvedEnv,
    skillMdContent,
    metaContent,
    checksum,
    syncedAt: now,
    priorErrors: errors,
    runtime: skillData.runtime,
  });
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
  apiKey?: string;
  env: Record<string, string>;
  config: Record<string, unknown>;
}

function buildSkillEntry(
  slug: string,
  skill: typeof skills.$inferSelect,
  enabled: boolean,
  assignmentConfig: Record<string, unknown>,
  resolvedEnv: Record<string, string>
): OpenClawSkillEntry {
  const primaryEnv = derivePrimaryEnvVar(slug);
  const metadata = isPlainObject(skill.metadata) ? skill.metadata : {};
  const apiKey = resolveApiKeyForSkill(metadata, slug, resolvedEnv);
  const authType = resolveAuthType(metadata);

  let env: Record<string, string> = {};
  if (Object.keys(resolvedEnv).length > 0) {
    env = resolvedEnv;
  } else if (authType === "header-api-key") {
    env = { [primaryEnv]: "$(resolve-from-vault)" };
  }

  return {
    enabled,
    ...(apiKey ? { apiKey } : {}),
    env,
    config: assignmentConfig,
  };
}

/**
 * Resolve secretRef values from the vault and map them to env var names
 * for writing into openclaw.json.
 */
async function resolveSkillEnvVars(
  companyId: string,
  slug: string,
  metadata: Record<string, unknown> | null | undefined,
  config: Record<string, unknown>
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const meta = metadata ?? {};
  const authType = resolveAuthType(meta);
  const primaryEnvVar = getPrimaryEnvVarFromMetadata(meta, slug);

  if (authType === "runtime-bearer") {
    const heartbeatSecret = await getHeartbeatSecret();
    if (heartbeatSecret) {
      env[primaryEnvVar] = heartbeatSecret;
    }
  }

  const secretNames = collectSecretRefNames(config);
  if (secretNames.size === 0) return env;

  for (const name of secretNames) {
    const value = await resolveSecretRef(companyId, { secretRef: { name } });
    if (value) {
      env[primaryEnvVar] = value;
    }
  }

  return env;
}

function getPrimaryEnvVarFromMetadata(metadata: Record<string, unknown>, slug: string): string {
  const openclaw = metadata.openclaw as Record<string, unknown> | undefined;
  if (openclaw && typeof openclaw.primaryEnv === "string") {
    return openclaw.primaryEnv;
  }
  if (openclaw) {
    const requires = openclaw.requires as Record<string, unknown> | undefined;
    if (requires && Array.isArray(requires.env) && typeof requires.env[0] === "string") {
      return requires.env[0];
    }
  }
  return derivePrimaryEnvVar(slug);
}

function resolveApiKeyForSkill(
  metadata: Record<string, unknown>,
  slug: string,
  resolvedEnv: Record<string, string>
): string | undefined {
  const auth = metadata.auth as Record<string, unknown> | undefined;
  if (auth?.type !== "header-api-key") {
    return undefined;
  }

  const primaryEnvVar = getPrimaryEnvVarFromMetadata(metadata, slug);
  const apiKey = resolvedEnv[primaryEnvVar];
  return typeof apiKey === "string" && apiKey.trim() ? apiKey : undefined;
}

function resolveAuthType(metadata: Record<string, unknown>): string | undefined {
  const auth = metadata.auth as Record<string, unknown> | undefined;
  return typeof auth?.type === "string" ? auth.type : undefined;
}

async function refreshSkillViaGateway(params: {
  runtime: typeof companyRuntimes.$inferSelect;
  slug: string;
  resolvedEnv: Record<string, string>;
  enabled: boolean;
  apiKey?: string;
}): Promise<void> {
  const meta = params.runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const client = new GatewayClient(
    params.runtime.gatewayUrl,
    params.runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    await client.skillsUpdate({
      skillKey: params.slug,
      enabled: params.enabled,
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      ...(Object.keys(params.resolvedEnv).length > 0 ? { env: params.resolvedEnv } : {}),
    });
  } finally {
    client.close();
  }
}

async function syncSkillViaFilesystem(params: {
  runtimeRef: string;
  workspaceRoot: string;
  slug: string;
  skill: typeof skills.$inferSelect;
  assignmentConfig: Record<string, unknown>;
  enabled: boolean;
  resolvedEnv: Record<string, string>;
  skillMdContent: string;
  metaContent: string;
  checksum: string;
  syncedAt: string;
  priorErrors: string[];
  runtime: typeof companyRuntimes.$inferSelect | null;
}): Promise<SyncResult> {
  const skillsDir = openclawSkillsDir({
    workspaceRoot: params.workspaceRoot,
    slug: params.slug,
  });
  const skillMdPath = join(skillsDir, "SKILL.md");
  const metaPath = join(skillsDir, ".crewcmd-meta.json");
  const openclawJsonPath = join(homedir(), ".openclaw", "openclaw.json");
  const errors = [...params.priorErrors];

  try {
    await atomicWrite(skillMdPath, params.skillMdContent);
  } catch (err) {
    errors.push(`Failed to write SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – SKILL.md", params.checksum, skillMdPath, openclawJsonPath, errors, params.syncedAt);
  }

  try {
    await atomicWrite(metaPath, params.metaContent);
  } catch (err) {
    errors.push(`Failed to write .crewcmd-meta.json: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – metadata", params.checksum, skillMdPath, openclawJsonPath, errors, params.syncedAt);
  }

  const skillEntry = buildSkillEntry(
    params.slug,
    params.skill,
    params.enabled,
    params.assignmentConfig,
    params.resolvedEnv
  );

  try {
    await mergeOpenclawJson(openclawJsonPath, params.runtimeRef, params.slug, skillEntry);
  } catch (err) {
    errors.push(`Failed to merge openclaw.json: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Write error – openclaw.json", params.checksum, skillMdPath, openclawJsonPath, errors, params.syncedAt);
  }

  if (params.runtime?.gatewayUrl) {
    try {
      await refreshSkillViaGateway({
        runtime: params.runtime,
        slug: params.slug,
        resolvedEnv: params.resolvedEnv,
        enabled: params.enabled,
        apiKey: skillEntry.apiKey,
      });
    } catch (err) {
      console.warn(
        `[sync-skill] Gateway refresh failed for ${params.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    try {
      await addSkillToGatewayAgentAllowlist({
        runtime: params.runtime,
        agentId: params.runtimeRef,
        slug: params.slug,
      });
    } catch (err) {
      console.warn(
        `[sync-skill] Gateway allowlist patch failed for ${params.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  try {
    const written = await readFile(skillMdPath, "utf-8");
    const actualChecksum = "sha256:" + sha256(written);
    if (actualChecksum !== params.checksum) {
      errors.push(`Checksum mismatch after write: expected ${params.checksum}, got ${actualChecksum}`);
    }
  } catch (err) {
    errors.push(`Failed to verify written file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) {
    return {
      success: false,
      skillPath: skillMdPath,
      configPath: openclawJsonPath,
      checksum: params.checksum,
      errors,
      syncedAt: params.syncedAt,
    };
  }

  return {
    success: true,
    skillPath: skillMdPath,
    configPath: openclawJsonPath,
    checksum: params.checksum,
    errors: [],
    syncedAt: params.syncedAt,
  };
}

// ─── Filesystem Operations ──────────────────────────────────────────

function openclawSkillsDir(params: {
  workspaceRoot: string;
  slug: string;
}): string {
  return join(params.workspaceRoot, "skills", params.slug);
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
  runtimeRef: string,
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

  ensureAgentSkillAllowlist(config, runtimeRef, slug);
  await atomicWrite(configPath, JSON.stringify(config, null, 2));
}

function ensureAgentSkillAllowlist(
  config: Record<string, unknown>,
  runtimeRef: string,
  slug: string
): void {
  const agentsConfig = config.agents as Record<string, unknown> | undefined;
  const agentList = agentsConfig?.list;
  if (!Array.isArray(agentList)) {
    return;
  }

  const agentEntry = agentList.find((value) => {
    if (!isPlainObject(value)) return false;
    return value.id === runtimeRef;
  });
  if (!isPlainObject(agentEntry) || !Array.isArray(agentEntry.skills)) {
    return;
  }

  const currentSkills = agentEntry.skills.filter(
    (value: unknown): value is string => typeof value === "string"
  );
  const hasSkill = currentSkills.some((value) => normalizeSkillName(value) === slug);
  if (!hasSkill) {
    agentEntry.skills = [...currentSkills, slug];
  }
}

function normalizeSkillName(value: string): string {
  return value.replace(/^\/+/, "");
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
