import { and, eq } from "drizzle-orm";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, withRetry } from "@/db";
import { agentSkills, agents, companyRuntimes, skills } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { removeSkillFromGatewayAgentAllowlist } from "./openclaw-gateway-skill-assignment";
import {
  defaultOpenClawWorkspaceRoot,
  resolveOpenClawWorkspaceRoot,
} from "./openclaw-workspace-resolver";

export interface UninstallSkillOptions {
  skillId: string;
  agentId: string;
  companyId?: string | null;
  workspaceId?: string | null;
  forceRemoveRuntimeConfigEntry?: boolean;
}

export interface UninstallSkillResult {
  success: boolean;
  removedPaths: string[];
  configPath: string;
  removedConfigEntry: boolean;
  errors: string[];
  warnings: string[];
  syncedAt: string;
}

interface SkillRemovalData {
  skill: typeof skills.$inferSelect;
  agent: typeof agents.$inferSelect;
  runtime: typeof companyRuntimes.$inferSelect | null;
}

export async function uninstallSkillFromOpenClaw(
  opts: UninstallSkillOptions
): Promise<UninstallSkillResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const removedPaths: string[] = [];
  const syncedAt = new Date().toISOString();
  const openclawJsonPath = join(homedir(), ".openclaw", "openclaw.json");

  let data: SkillRemovalData;
  try {
    data = await loadSkillRemovalData(opts);
  } catch (err) {
    return {
      success: false,
      removedPaths,
      configPath: openclawJsonPath,
      removedConfigEntry: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
      syncedAt,
    };
  }

  const sharedWorkspaceRoot =
    await resolveOpenClawWorkspaceRoot({
    runtimeRef: data.agent.runtimeRef ?? data.agent.id,
    workspacePath: data.agent.workspacePath ?? null,
    }) ?? defaultOpenClawWorkspaceRoot();
  const skillDir = skillDirectoryFor({
    workspaceRoot: sharedWorkspaceRoot,
    slug: data.skill.slug,
  });

  try {
    await removeAgentSkillAllowlistEntry(openclawJsonPath, data.agent.runtimeRef ?? data.agent.id, data.skill.slug);
  } catch (err) {
    errors.push(`Failed to update agent skill allowlist: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (data.runtime?.gatewayUrl) {
    try {
      await removeSkillFromGatewayAgentAllowlist({
        runtime: data.runtime,
        agentId: data.agent.runtimeRef ?? data.agent.id,
        slug: data.skill.slug,
      });
    } catch (err) {
      warnings.push(`Gateway allowlist removal failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const shouldRemoveConfigEntry = await shouldRemoveRuntimeConfigEntry({
    skillId: opts.skillId,
    runtimeId: data.agent.runtimeId ?? null,
    agentId: opts.agentId,
    force: opts.forceRemoveRuntimeConfigEntry === true,
  });

  let removedConfigEntry = false;
  if (shouldRemoveConfigEntry) {
    try {
      await rm(skillDir, { recursive: true, force: true });
      removedPaths.push(skillDir);
    } catch (err) {
      errors.push(`Failed to remove skill directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      removedConfigEntry = await removeOpenClawSkillEntry(openclawJsonPath, data.skill.slug);
    } catch (err) {
      errors.push(`Failed to update openclaw.json: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (data.runtime?.gatewayUrl) {
      try {
        await disableSkillViaGateway(data.runtime, data.skill.slug);
      } catch (err) {
        warnings.push(`Gateway disable failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    success: errors.length === 0,
    removedPaths,
    configPath: openclawJsonPath,
    removedConfigEntry,
    errors,
    warnings,
    syncedAt,
  };
}

async function loadSkillRemovalData(
  opts: UninstallSkillOptions
): Promise<SkillRemovalData> {
  if (!db) throw new Error("Database not initialized");

  const [agent] = await withRetry(() =>
    db!
      .select()
      .from(agents)
      .where(eq(agents.id, opts.agentId))
      .limit(1)
  );

  if (!agent) {
    throw new Error(`Agent ${opts.agentId} not found`);
  }

  const [skill] = await withRetry(() => {
    if (opts.workspaceId) {
      return db!
        .select()
        .from(skills)
        .where(and(eq(skills.id, opts.skillId), eq(skills.workspaceId, opts.workspaceId)))
        .limit(1);
    }
    if (opts.companyId) {
      return db!
        .select()
        .from(skills)
        .where(and(eq(skills.id, opts.skillId), eq(skills.companyId, opts.companyId)))
        .limit(1);
    }
    return db!
      .select()
      .from(skills)
      .where(eq(skills.id, opts.skillId))
      .limit(1);
  });

  if (!skill) {
    throw new Error(`Skill ${opts.skillId} not found for the provided scope`);
  }

  let runtime: typeof companyRuntimes.$inferSelect | null = null;
  if (agent.runtimeId) {
    const runtimeId = agent.runtimeId;
    const [runtimeRow] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(eq(companyRuntimes.id, runtimeId))
        .limit(1)
    );
    runtime = runtimeRow ?? null;
  }

  return { skill, agent, runtime };
}

async function shouldRemoveRuntimeConfigEntry(params: {
  skillId: string;
  runtimeId: string | null;
  agentId: string;
  force?: boolean;
}): Promise<boolean> {
  if (params.force) return true;
  if (!db) return false;
  if (!params.runtimeId) return true;
  const runtimeId = params.runtimeId;

  const assignments = await withRetry(() =>
    db!
      .select({
        agentId: agentSkills.agentId,
      })
      .from(agentSkills)
      .innerJoin(agents, eq(agentSkills.agentId, agents.id))
      .where(
        and(
          eq(agentSkills.skillId, params.skillId),
          eq(agents.runtimeId, runtimeId)
        )
      )
  );

  return assignments.every((row) => row.agentId === params.agentId);
}

async function removeOpenClawSkillEntry(configPath: string, slug: string): Promise<boolean> {
  let config: Record<string, unknown>;

  try {
    config = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const skillsConfig = config.skills as Record<string, unknown> | undefined;
  const entries = skillsConfig?.entries as Record<string, unknown> | undefined;
  if (!entries || !(slug in entries)) {
    return false;
  }

  delete entries[slug];
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  return true;
}

async function disableSkillViaGateway(
  runtime: typeof companyRuntimes.$inferSelect,
  slug: string
): Promise<void> {
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    await client.skillsUpdate({
      skillKey: slug,
      enabled: false,
    });
  } finally {
    client.close();
  }
}

function skillDirectoryFor(params: {
  workspaceRoot: string;
  slug: string;
}): string {
  return join(params.workspaceRoot, "skills", params.slug);
}

async function removeAgentSkillAllowlistEntry(
  configPath: string,
  runtimeRef: string,
  slug: string
): Promise<void> {
  let config: Record<string, unknown>;

  try {
    config = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }

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

  const nextSkills = agentEntry.skills
    .filter((value: unknown): value is string => typeof value === "string")
    .filter((value) => normalizeSkillName(value) !== slug);
  agentEntry.skills = nextSkills;

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function normalizeSkillName(value: string): string {
  return value.replace(/^\/+/, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
