/**
 * Skill sync from CrewCMD DB to an OpenClaw gateway runtime.
 *
 * Public entry-point:
 *   syncSkillToOpenClaw({ skillId, agentId, companyId })
 */

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, withRetry } from "@/db";
import { agentSkills, agents, companyRuntimes, skills } from "@/db/schema";
import { collectSecretRefNames, resolveSecretRef } from "./service-secrets";
import { getHeartbeatSecret } from "./heartbeat-secret";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { generateCrewCmdSkill } from "./crewcmd-skill-template";
import { generateCrewCmdOperatingLayerSkill } from "./crewcmd-operating-skill-template";

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncSkillOptions {
  skillId: string;
  agentId: string;
  companyId?: string | null;
  workspaceId?: string | null;
  dryRun?: boolean;
}

export interface SyncResult {
  success: boolean;
  skillPath: string;
  configPath: string;
  checksum: string;
  errors: string[];
  syncedAt: string;
  nativeInstall?: {
    provider: "clawhub";
    slug: string;
    version?: string;
    installed: boolean;
    warnings: string[];
  };
}

interface SkillData {
  skill: typeof skills.$inferSelect;
  agent: typeof agents.$inferSelect;
  assignment: typeof agentSkills.$inferSelect;
  runtime: typeof companyRuntimes.$inferSelect | null;
}

// ─── Constants ──────────────────────────────────────────────────────

const CREWCMD_MANAGEMENT_SLUG = "crewcmd-management";
const CREWCMD_OPERATING_LAYER_SLUG = "crewcmd-operating-layer";

export interface NativeClawhubInstallRequest {
  provider: "clawhub";
  slug: string;
  version?: string;
  force?: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Sync a single CrewCMD skill assignment into OpenClaw's gateway-owned skill
 * config and update the target agent's explicit skill allowlist when present.
 */
export async function syncSkillToOpenClaw(
  opts: SyncSkillOptions
): Promise<SyncResult> {
  const errors: string[] = [];
  const now = new Date().toISOString();

  let skillData: SkillData;
  try {
    skillData = await loadSkillData(opts.skillId, opts.agentId, {
      companyId: opts.companyId ?? null,
      workspaceId: opts.workspaceId ?? null,
    });
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

  const skillMdContent = renderSkillMd(
    skillData.skill,
    assignmentConfig as Record<string, unknown>
  );
  const checksum = "sha256:" + sha256(skillMdContent);
  const resolvedEnv = await resolveSkillEnvVars(
    {
      companyId: opts.companyId ?? skillData.skill.companyId ?? null,
      workspaceId: opts.workspaceId ?? skillData.skill.workspaceId ?? null,
    },
    slug,
    skillData.skill.metadata,
    assignmentConfig as Record<string, unknown>
  );
  const configTarget = skillData.runtime?.gatewayUrl
    ? `openclaw-gateway:${skillData.runtime.gatewayUrl}`
    : "";

  // ── Dry-run shortcut ─────────────────────────────────────────
  if (opts.dryRun) {
    return {
      success: true,
      skillPath: "",
      configPath: configTarget,
      checksum,
      errors: [],
      syncedAt: now,
    };
  }

  if (!skillData.runtime?.gatewayUrl) {
    return makeFailure(
      "OpenClaw skill sync requires a connected gateway runtime",
      checksum,
      "",
      configTarget,
      errors,
      now
    );
  }

  const skillEntry = buildSkillEntry(
    slug,
    skillData.skill,
    skillData.assignment.enabled,
    assignmentConfig as Record<string, unknown>,
    resolvedEnv
  );

  const nativeInstall = resolveNativeClawhubInstallRequest(skillData.skill.metadata, skillData.skill.slug, skillData.skill.version ?? undefined);

  try {
    const gatewayResult = await syncSkillEntryViaGateway({
      runtime: skillData.runtime,
      runtimeRef,
      slug,
      entry: skillEntry,
      nativeInstall,
    });

    return {
      success: true,
      skillPath: gatewayResult.skillPath,
      configPath: configTarget,
      checksum,
      errors: [],
      syncedAt: now,
      ...(gatewayResult.nativeInstall
        ? {
            nativeInstall: {
              provider: "clawhub",
              slug: gatewayResult.nativeInstall.slug,
              version: gatewayResult.nativeInstall.version,
              installed: gatewayResult.nativeInstall.installed,
              warnings: gatewayResult.nativeInstall.warnings,
            },
          }
        : {}),
    };
  } catch (err) {
    errors.push(`Failed to sync gateway config: ${err instanceof Error ? err.message : String(err)}`);
    return makeFailure("Gateway config sync failed", checksum, "", configTarget, errors, now);
  }
}

// ─── DB Loading ─────────────────────────────────────────────────────

async function loadSkillData(
  skillId: string,
  agentId: string,
  scope: { companyId?: string | null; workspaceId?: string | null }
): Promise<SkillData> {
  if (!db) throw new Error("Database not initialized");

  // Load agent — verify it belongs to this company
  const [agentRows] = await withRetry(() =>
    db!
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1)
  );

  if (!agentRows) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Load skill
  const [skillRows] = await withRetry(() => {
    if (scope.workspaceId) {
      return db!
        .select()
        .from(skills)
        .where(and(eq(skills.id, skillId), eq(skills.workspaceId, scope.workspaceId)))
        .limit(1);
    }
    if (scope.companyId) {
      return db!
        .select()
        .from(skills)
        .where(and(eq(skills.id, skillId), eq(skills.companyId, scope.companyId)))
        .limit(1);
    }
    return db!
      .select()
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1);
  });

  if (!skillRows) {
    throw new Error(`Skill ${skillId} not found for the provided scope`);
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

  // Load runtime info for gateway-native sync
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

function renderSkillMd(
  skill: typeof skills.$inferSelect,
  assignmentConfig: Record<string, unknown>
): string {
  if (skill.slug === CREWCMD_OPERATING_LAYER_SLUG) {
    const rolePack = typeof assignmentConfig.rolePack === "string"
      ? assignmentConfig.rolePack.trim()
      : "developer";
    const mode = typeof assignmentConfig.mode === "string"
      ? assignmentConfig.mode.trim()
      : "imported-overlay";
    const overlayContent = typeof assignmentConfig.overlayContent === "string"
      ? assignmentConfig.overlayContent.trim()
      : "";

    if (!overlayContent) {
      return generateSkillMd(skill);
    }

    return generateSkillMd({
      ...skill,
      content: generateCrewCmdOperatingLayerSkill({
        rolePack,
        mode,
        overlayContent,
      }),
    });
  }

  if (skill.slug !== CREWCMD_MANAGEMENT_SLUG) {
    return generateSkillMd(skill);
  }

  const baseUrl = typeof assignmentConfig.baseUrl === "string"
    ? assignmentConfig.baseUrl.trim()
    : "";
  const workspaceId = typeof assignmentConfig.workspaceId === "string"
    ? assignmentConfig.workspaceId.trim()
    : "";
  const companyId = typeof assignmentConfig.companyId === "string"
    ? assignmentConfig.companyId.trim()
    : null;

  if (!baseUrl || !workspaceId) {
    return generateSkillMd(skill);
  }

  return generateSkillMd({
    ...skill,
    content: generateCrewCmdSkill({
      baseUrl,
      workspaceId,
      companyId,
    }),
  });
}

function extractOpenclawMetadata(
  metadata: Record<string, unknown> | null | undefined,
  slug: string
): Record<string, unknown> {
  let envVars: string[] = [];
  let primaryEnv: string | undefined;
  const authType =
    metadata && typeof (metadata.auth as Record<string, unknown> | undefined)?.type === "string"
      ? ((metadata.auth as Record<string, unknown>).type as string)
      : undefined;

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
  if (envVars.length === 0 && authType !== "none") {
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

// ─── Gateway Skill Entry ───────────────────────────────────────────

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
 * for writing into the gateway-owned skill entry.
 */
async function resolveSkillEnvVars(
  scope: { companyId?: string | null; workspaceId?: string | null },
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
    if (typeof config.runtimeId === "string" && config.runtimeId.trim()) {
      env.CREWCMD_RUNTIME_ID = config.runtimeId.trim();
    }
  }

  const secretNames = collectSecretRefNames(config);
  if (secretNames.size === 0) return env;

  for (const name of secretNames) {
    const value = await resolveSecretRef(scope, { secretRef: { name } });
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

async function syncSkillEntryViaGateway(params: {
  runtime: typeof companyRuntimes.$inferSelect;
  runtimeRef: string;
  slug: string;
  entry: OpenClawSkillEntry;
  nativeInstall?: NativeClawhubInstallRequest | null;
}): Promise<{ skillPath: string; nativeInstall?: SyncResult["nativeInstall"] }> {
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

    let nativeResult: SyncResult["nativeInstall"] | undefined;
    let nativeSkillPath = "";
    if (params.nativeInstall) {
      const install = await client.skillsInstall({
        source: "clawhub",
        slug: params.nativeInstall.slug,
        ...(params.nativeInstall.version ? { version: params.nativeInstall.version } : {}),
        ...(typeof params.nativeInstall.force === "boolean" ? { force: params.nativeInstall.force } : {}),
      });
      nativeSkillPath = typeof install.path === "string" ? install.path : "";
      nativeResult = {
        provider: "clawhub",
        slug: install.slug || params.nativeInstall.slug,
        version: install.version || params.nativeInstall.version,
        installed: install.installed ?? install.ok ?? true,
        warnings: [
          ...(typeof install.warning === "string" ? [install.warning] : []),
          ...(Array.isArray(install.warnings) ? install.warnings.filter((value): value is string => typeof value === "string") : []),
        ],
      };
    }

    const snapshot = await client.configGet();
    const agentEntry = findGatewayAgentEntry(snapshot.config, params.runtimeRef);
    if (!agentEntry) {
      throw new Error(`Agent ${params.runtimeRef} not found in gateway config`);
    }

    const nextSkills = nextAgentSkills(agentEntry.skills, params.slug);
    const nextEntry = mergeGatewaySkillEntry(
      readGatewaySkillEntry(snapshot.config, params.slug),
      params.entry
    );
    const patch: Record<string, unknown> = {
      skills: {
        entries: {
          [params.slug]: nextEntry,
        },
      },
    };

    if (Array.isArray(agentEntry.skills)) {
      patch.agents = {
        list: [
          {
            id: params.runtimeRef,
            skills: nextSkills,
          },
        ],
      };
    }

    await client.configPatch({
      patch,
      baseHash: snapshot.hash,
      note: `CrewCMD synced ${params.slug} to ${params.runtimeRef}`,
    });

    await client.skillsUpdate({
      skillKey: params.slug,
      enabled: params.entry.enabled,
      ...(params.entry.apiKey ? { apiKey: params.entry.apiKey } : {}),
      ...(Object.keys(params.entry.env).length > 0 ? { env: params.entry.env } : {}),
    });

    return {
      skillPath: nativeSkillPath,
      ...(nativeResult ? { nativeInstall: nativeResult } : {}),
    };
  } finally {
    client.close();
  }
}

export function resolveNativeClawhubInstallRequest(
  metadata: Record<string, unknown> | null | undefined,
  fallbackSlug: string,
  fallbackVersion?: string
): NativeClawhubInstallRequest | null {
  const meta = isPlainObject(metadata) ? metadata : {};
  const provider = isPlainObject(meta.provider) ? meta.provider : null;
  const source = typeof meta.source === "string" ? meta.source : undefined;
  const providerId = typeof provider?.id === "string" ? provider.id : undefined;

  if (providerId !== "clawhub" && source !== "clawhub") {
    return null;
  }

  const slug = typeof provider?.skillId === "string" && provider.skillId.trim()
    ? provider.skillId.trim()
    : fallbackSlug;
  const version = typeof provider?.version === "string" && provider.version.trim()
    ? provider.version.trim()
    : fallbackVersion;

  return {
    provider: "clawhub",
    slug,
    ...(version ? { version } : {}),
  };
}

function findGatewayAgentEntry(
  config: Record<string, unknown>,
  runtimeRef: string
): Record<string, unknown> | null {
  const agentsConfig = isPlainObject(config.agents) ? config.agents : null;
  const agentList = agentsConfig?.list;
  if (!Array.isArray(agentList)) return null;

  const match = agentList.find(
    (value) => isPlainObject(value) && value.id === runtimeRef
  );
  return isPlainObject(match) ? match : null;
}

function readGatewaySkillEntry(
  config: Record<string, unknown>,
  slug: string
): Record<string, unknown> {
  const skillsConfig = isPlainObject(config.skills) ? config.skills : null;
  const entries = isPlainObject(skillsConfig?.entries) ? skillsConfig.entries : null;
  const entry = entries?.[slug];
  return isPlainObject(entry) ? entry : {};
}

function nextAgentSkills(value: unknown, slug: string): string[] {
  const current = Array.isArray(value)
    ? value
        .filter((entry: unknown): entry is string => typeof entry === "string")
        .map(normalizeSkillName)
    : [];

  return current.includes(slug) ? current : [...current, slug];
}

function mergeGatewaySkillEntry(
  existing: Record<string, unknown>,
  entry: OpenClawSkillEntry
): OpenClawSkillEntry {
  const existingEnv = isPlainObject(existing.env) ? existing.env : {};
  const existingConfig = isPlainObject(existing.config) ? existing.config : {};

  return {
    enabled: entry.enabled,
    ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    env: {
      ...(existingEnv as Record<string, string>),
      ...entry.env,
    },
    config: deepMerge(existingConfig, entry.config),
  };
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
