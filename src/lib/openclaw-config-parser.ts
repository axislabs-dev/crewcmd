/**
 * OpenClaw Config Parser
 *
 * Parses openclaw.json to extract agents, models, gateway config,
 * and agent workspace files (IDENTITY.md, SOUL.md, etc.)
 *
 * Used for the "Import from OpenClaw" onboarding flow.
 * Runs server-side only. Never sends the raw config over the wire.
 */

import { readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// ─── Types ──────────────────────────────────────────────────────────

export interface OpenClawAgentConfig {
  id: string;
  name?: string;
  model?: {
    primary?: string;
    fallbacks?: string[];
  };
  skills?: string[];
  workspace?: string;
  heartbeat?: {
    every?: string;
  };
  identity?: {
    name?: string;
    emoji?: string;
    avatar?: string;
    theme?: string;
  };
}

export interface OpenClawGatewayConfig {
  port?: number;
  bind?: string;
  auth?: {
    mode?: string;
    token?: string;
  };
}

export interface OpenClawModelProvider {
  name: string;
  apiKey?: string; // Will be redacted before sending to client
}

export interface OpenClawConfig {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: OpenClawAgentConfig[];
  };
  gateway?: OpenClawGatewayConfig;
  models?: {
    default?: string;
    providers?: Record<string, unknown>;
  };
  channels?: Record<string, unknown>;
}

export interface ParsedAgent {
  id: string;
  name: string;
  emoji: string;
  title: string;
  description: string;
  model?: string;
  workspace?: string;
  skills: string[];
  reportsTo?: string;
  identityRaw?: string;
  soulRaw?: string;
}

export interface ParseResult {
  ok: boolean;
  error?: string;
  agents: ParsedAgent[];
  models: string[];
  gatewayUrl?: string;
  gatewayPort?: number;
  defaultModel?: string;
  defaultAgentId?: string;
}

// ─── Default Paths ──────────────────────────────────────────────────

const DEFAULT_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

// ─── File Reading ───────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// ─── Config Parsing ─────────────────────────────────────────────────

/**
 * Parse an openclaw.json config (from file path or raw content).
 * Extracts agents, models, gateway info. Reads workspace files for each agent.
 * Never returns raw API keys or tokens.
 */
export async function parseOpenClawConfig(
  input: { path?: string; content?: string }
): Promise<ParseResult> {
  let config: OpenClawConfig;

  try {
    if (input.content) {
      config = JSON.parse(input.content);
    } else {
      const configPath = input.path || DEFAULT_CONFIG_PATH;
      if (!(await fileExists(configPath))) {
        return {
          ok: false,
          error: `Config file not found: ${configPath}`,
          agents: [],
          models: [],
        };
      }
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse config: ${err instanceof Error ? err.message : String(err)}`,
      agents: [],
      models: [],
    };
  }

  const agents: ParsedAgent[] = [];
  const modelSet = new Set<string>();

  // Extract default model
  const defaultModel = typeof config.models?.default === "string"
    ? config.models.default
    : undefined;
  if (defaultModel) modelSet.add(defaultModel);

  // Extract model provider names (not keys)
  if (config.models?.providers && typeof config.models.providers === "object") {
    for (const provider of Object.keys(config.models.providers)) {
      // Just note the provider names, not API keys
      modelSet.add(provider);
    }
  }

  // Parse agents
  const agentList = config.agents?.list || [];
  let defaultAgentId: string | undefined;

  for (const agentConfig of agentList) {
    if (!agentConfig.id) continue;

    // Track the first agent or "main" as default
    if (!defaultAgentId || agentConfig.id === "main") {
      defaultAgentId = agentConfig.id;
    }

    // Track agent models
    if (agentConfig.model?.primary) {
      modelSet.add(agentConfig.model.primary);
    }
    if (agentConfig.model?.fallbacks) {
      agentConfig.model.fallbacks.forEach((m) => modelSet.add(m));
    }

    // Read workspace files if workspace path is available
    let identityRaw: string | undefined;
    let soulRaw: string | undefined;
    let name = agentConfig.name || agentConfig.identity?.name || agentConfig.id;
    let emoji = agentConfig.identity?.emoji || "🤖";
    let title = "Agent";
    let description = "";
    let reportsTo: string | undefined;

    const workspacePath = agentConfig.workspace;
    if (workspacePath && (await fileExists(workspacePath))) {
      // Read IDENTITY.md
      const identityPath = join(workspacePath, "IDENTITY.md");
      identityRaw = (await readFileContent(identityPath)) ?? undefined;
      if (identityRaw) {
        const parsed = parseIdentityMd(identityRaw);
        if (parsed.name) name = parsed.name;
        if (parsed.emoji) emoji = parsed.emoji;
        if (parsed.title) title = parsed.title;
        if (parsed.description) description = parsed.description;
      }

      // Read SOUL.md
      const soulPath = join(workspacePath, "SOUL.md");
      soulRaw = (await readFileContent(soulPath)) ?? undefined;
      if (soulRaw && !description) {
        description = parseSoulDescription(soulRaw);
      }

      // Read AGENTS.md for reportsTo
      const agentsPath = join(workspacePath, "AGENTS.md");
      const agentsMd = await readFileContent(agentsPath);
      if (agentsMd) {
        reportsTo = parseReportsTo(agentsMd);
      }
    }

    agents.push({
      id: agentConfig.id,
      name,
      emoji,
      title,
      description,
      model: agentConfig.model?.primary,
      workspace: workspacePath,
      skills: agentConfig.skills || [],
      reportsTo,
      identityRaw,
      soulRaw,
    });
  }

  // Gateway config (redacted)
  const gatewayPort = config.gateway?.port;
  const gatewayBind = config.gateway?.bind || "loopback";
  const gatewayHost = gatewayBind === "lan" ? "0.0.0.0" : "127.0.0.1";
  const gatewayUrl = gatewayPort
    ? `ws://${gatewayHost}:${gatewayPort}`
    : undefined;

  return {
    ok: true,
    agents,
    models: Array.from(modelSet),
    gatewayUrl,
    gatewayPort,
    defaultModel,
    defaultAgentId,
  };
}

// ─── Markdown Parsers ───────────────────────────────────────────────

function parseIdentityMd(content: string): {
  name?: string;
  emoji?: string;
  title?: string;
  description?: string;
} {
  const result: { name?: string; emoji?: string; title?: string; description?: string } = {};

  const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
  if (nameMatch?.[1]?.trim() && !nameMatch[1].includes("pick something")) {
    result.name = nameMatch[1].trim();
  }

  const emojiMatch = content.match(/\*\*Emoji:\*\*\s*(.+)/);
  if (emojiMatch?.[1]?.trim()) {
    result.emoji = emojiMatch[1].trim();
  }

  const creatureMatch = content.match(/\*\*Creature:\*\*\s*(.+)/);
  if (creatureMatch?.[1]?.trim() && !creatureMatch[1].includes("_")) {
    result.title = creatureMatch[1].trim();
  }

  const vibeMatch = content.match(/\*\*Vibe:\*\*\s*(.+)/);
  if (vibeMatch?.[1]?.trim() && !vibeMatch[1].includes("_")) {
    result.description = vibeMatch[1].trim();
  }

  return result;
}

function parseSoulDescription(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const descLine = lines.find(
    (l) =>
      !l.startsWith("#") &&
      !l.startsWith("_") &&
      !l.startsWith("-") &&
      l.length > 20
  );
  return descLine ? descLine.trim().slice(0, 200) : "";
}

function parseReportsTo(content: string): string | undefined {
  // Look for "Reports to: <callsign>" or "reportsTo: <callsign>" pattern
  const match = content.match(/reports?\s*to[:\s]+(\w+)/i);
  return match?.[1];
}
