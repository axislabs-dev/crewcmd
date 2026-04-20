/**
 * Push skill secrets from CrewCmd's vault to an OpenClaw gateway.
 *
 * Works for both local and remote gateways — uses the WebSocket RPC
 * `skills.update` method to set native skill auth/env on the runtime side.
 *
 * Flow:
 * 1. Load the skill assignment + config from DB
 * 2. Collect all secretRef names from the config
 * 3. Resolve each secret from the company vault
 * 4. Map to env/apiKey fields from skill metadata
 * 5. Connect to the gateway and call skills.update with the resolved secret values
 */

import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { agentSkills, companyRuntimes, skills } from "@/db/schema";
import { collectSecretRefNames, resolveSecretRef } from "./service-secrets";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import { derivePrimaryEnvVar } from "./sync-skill-to-openclaw";
import { loadScopedSkillForAgent } from "./skill-scope";

// ─── Types ──────────────────────────────────────────────────────────

export interface PushSecretsOptions {
  skillId: string;
  agentId: string;
  companyId?: string | null;
}

export interface PushSecretsResult {
  ok: boolean;
  envVarsPushed: string[];
  errors: string[];
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Resolve secrets for a skill assignment and push them to the agent's
 * gateway as env vars via `skills.update` RPC.
 */
export async function pushSecretsToGateway(
  opts: PushSecretsOptions
): Promise<PushSecretsResult> {
  if (!db) {
    return { ok: false, envVarsPushed: [], errors: ["Database not available"] };
  }

  // Load agent + runtime
  const scoped = await loadScopedSkillForAgent({ skillId: opts.skillId, agentId: opts.agentId });
  const agent = scoped?.agent;

  if (!agent) {
    return { ok: false, envVarsPushed: [], errors: [`Agent ${opts.agentId} not found`] };
  }

  if (!agent.runtimeId) {
    return { ok: false, envVarsPushed: [], errors: ["Agent has no runtime connected"] };
  }

  // Load runtime
  const [runtime] = await withRetry(() =>
    db!.select().from(companyRuntimes).where(eq(companyRuntimes.id, agent.runtimeId!))
  );

  if (!runtime) {
    return { ok: false, envVarsPushed: [], errors: ["Runtime not found"] };
  }

  // Load skill + assignment
  const skill = scoped?.skill;

  if (!skill) {
    return { ok: false, envVarsPushed: [], errors: [`Skill ${opts.skillId} not found`] };
  }

  const [assignment] = await withRetry(() =>
    db!
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.agentId, opts.agentId), eq(agentSkills.skillId, opts.skillId)))
      .limit(1)
  );

  if (!assignment) {
    return { ok: false, envVarsPushed: [], errors: ["Skill not assigned to agent"] };
  }

  // Resolve secrets from config
  const config = isRecord(assignment.config) ? assignment.config : {};
  const envMap = await resolveEnvMap(agent.companyId ?? null, skill, config);

  if (envMap.errors.length > 0) {
    return { ok: false, envVarsPushed: [], errors: envMap.errors };
  }

  if (Object.keys(envMap.env).length === 0) {
    return { ok: true, envVarsPushed: [], errors: [] };
  }

  // Push to gateway
  const meta = runtime.metadata as Record<string, unknown> | null;
  const deviceKeyPem = meta?.devicePrivateKeyPem as string | undefined;
  const device = resolveDeviceIdentity(deviceKeyPem);
  const client = new GatewayClient(
    runtime.gatewayUrl,
    runtime.authToken || null,
    device,
    15000
  );

  try {
    await client.connect();
    // OpenClaw stores skill entry config by skillKey in gateway config.
    // This is currently gateway-global rather than per-agent.
    await client.skillsUpdate({
      skillKey: skill.slug,
      enabled: assignment.enabled,
      ...(envMap.apiKey ? { apiKey: envMap.apiKey } : {}),
      env: envMap.env,
    });

    const pushed = Object.keys(envMap.env);
    console.log(
      `[push-secrets] Pushed ${pushed.length} env var(s) for skill ${skill.slug} to agent ${agent.callsign}: ${pushed.join(", ")}`
    );

    return { ok: true, envVarsPushed: pushed, errors: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, envVarsPushed: [], errors: [`Gateway RPC failed: ${message}`] };
  } finally {
    client.close();
  }
}

// ─── Env Var Resolution ─────────────────────────────────────────────

interface EnvMapResult {
  apiKey?: string;
  env: Record<string, string>;
  errors: string[];
}

/**
 * Resolve all secretRef values in a skill config to a map of
 * env var names → secret values.
 *
 * Env var naming priority:
 * 1. metadata.auth.secretRefField → maps to the primary env var
 * 2. metadata.openclaw.requires.env → explicit env var names
 * 3. Derived from slug: SLUG_API_KEY
 */
async function resolveEnvMap(
  companyId: string | null,
  skill: typeof skills.$inferSelect,
  config: Record<string, unknown>
): Promise<EnvMapResult> {
  const errors: string[] = [];
  const env: Record<string, string> = {};

  // Collect all secret ref names from the config
  const secretNames = collectSecretRefNames(config);
  if (secretNames.size === 0) {
    return { env, errors };
  }

  const metadata = isRecord(skill.metadata) ? skill.metadata : {};

  // Determine the primary env var name for this skill
  const primaryEnvVar = getPrimaryEnvVar(metadata, skill.slug);

  // Resolve each secret
  for (const name of secretNames) {
    const value = await resolveSecretRef(companyId, { secretRef: { name } });
    if (!value) {
      errors.push(`Secret "${name}" not found in vault`);
      continue;
    }

    // Map to env var name. For the primary secret (referenced by
    // metadata.auth.secretRefField), use the primary env var name.
    // For additional secrets, derive from the secret name.
    const envVarName = getEnvVarForSecret(metadata, name, primaryEnvVar);
    env[envVarName] = value;
  }

  return {
    apiKey: isApiKeySkill(metadata) ? env[primaryEnvVar] : undefined,
    env,
    errors,
  };
}

/**
 * Determine the primary env var name for a skill.
 */
function getPrimaryEnvVar(metadata: Record<string, unknown>, slug: string): string {
  // Check metadata.openclaw.primaryEnv
  const openclaw = metadata.openclaw as Record<string, unknown> | undefined;
  if (openclaw && typeof openclaw.primaryEnv === "string") {
    return openclaw.primaryEnv;
  }

  // Check metadata.openclaw.requires.env[0]
  if (openclaw) {
    const requires = openclaw.requires as Record<string, unknown> | undefined;
    if (requires && Array.isArray(requires.env) && typeof requires.env[0] === "string") {
      return requires.env[0];
    }
  }

  // Derive from slug
  return derivePrimaryEnvVar(slug);
}

/**
 * Map a secret name to an env var name.
 *
 * If the secret is the one referenced by metadata.auth.secretRefField,
 * it gets the primary env var name. Otherwise, derive from the secret name.
 */
function getEnvVarForSecret(
  metadata: Record<string, unknown>,
  _secretName: string,
  primaryEnvVar: string
): string {
  // Check if this is the primary auth secret
  const auth = metadata.auth as Record<string, unknown> | undefined;
  if (auth && typeof auth.secretRefField === "string") {
    return primaryEnvVar;
  }

  // For skills without auth metadata, the first (often only) secret is primary
  return primaryEnvVar;
}

function isApiKeySkill(metadata: Record<string, unknown>): boolean {
  const auth = metadata.auth as Record<string, unknown> | undefined;
  return auth?.type === "header-api-key";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
