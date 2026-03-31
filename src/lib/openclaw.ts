import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import type { Agent, AgentStatus } from "./data";

// --- Types ---

export interface OpenClawAgent {
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
  isDefault?: boolean;
}

export interface OpenClawSessionEntry {
  key: string;
  updatedAt: number;
  age: number;
}

export interface OpenClawHealthAgent {
  agentId: string;
  name?: string;
  isDefault?: boolean;
  sessions?: {
    path: string;
    count: number;
    recent: OpenClawSessionEntry[];
  };
}

export interface OpenClawNode {
  id: string;
  name: string;
  hostname?: string;
  status: "connected" | "disconnected" | "unknown";
  connectedAt?: string;
  lastSeen?: string;
  capabilities?: string[];
  platform?: string;
  version?: string;
  remoteIp?: string;
}

export interface OpenClawHealth {
  status: string;
  uptime?: number;
  version?: string;
  agents?: number;
  sessions?: number;
  nodes?: number;
  gateway?: Record<string, unknown>;
}

// --- Config ---

function getGatewayToken(): string | null {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    return process.env.OPENCLAW_GATEWAY_TOKEN;
  }
  try {
    const configPath = join(
      process.env.HOME || "/Users/roger",
      ".openclaw",
      "openclaw.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

// --- CLI Executor ---

function execOpenClaw(command: string): unknown | null {
  try {
    const result = execSync(`openclaw ${command}`, {
      timeout: 10000,
      encoding: "utf-8",
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: getGatewayToken() ?? undefined,
      },
    });
    // Parse JSON — handle potential non-JSON prefix lines
    const trimmed = result.trim();
    const jsonStart = trimmed.indexOf("[") === -1
      ? trimmed.indexOf("{")
      : Math.min(
          trimmed.indexOf("["),
          trimmed.indexOf("{") === -1 ? Infinity : trimmed.indexOf("{")
        );
    if (jsonStart === -1) return null;
    return JSON.parse(trimmed.slice(jsonStart));
  } catch (err) {
    console.error(`[openclaw] Failed to exec: openclaw ${command}`, err);
    return null;
  }
}

// --- Data Fetchers ---

export async function fetchAgents(): Promise<OpenClawAgent[] | null> {
  const data = execOpenClaw("agents list --json");
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.agents)) return obj.agents as OpenClawAgent[];
    if (Array.isArray(obj.list)) return obj.list as OpenClawAgent[];
  }
  return null;
}

/**
 * Fetch health data from OpenClaw. The health JSON includes per-agent session
 * info which we use to derive agent status.
 */
export async function fetchHealthRaw(): Promise<Record<string, unknown> | null> {
  const data = execOpenClaw("health --json");
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

export async function fetchHealth(): Promise<OpenClawHealth | null> {
  const raw = await fetchHealthRaw();
  if (!raw) return null;

  const agentsArr = raw.agents as OpenClawHealthAgent[] | undefined;
  const totalSessions = agentsArr
    ? agentsArr.reduce((sum, a) => sum + (a.sessions?.count ?? 0), 0)
    : 0;

  return {
    status: raw.ok ? "ok" : "degraded",
    version: typeof raw.version === "string" ? raw.version : undefined,
    agents: agentsArr?.length,
    sessions: totalSessions,
  };
}

// Known node display names — used to query `nodes describe`
const KNOWN_NODES = [
  "Mac Mini M4 (Trading Floor)",
  "Mac Mini i7 (War Room)",
];

export async function fetchNodes(): Promise<OpenClawNode[] | null> {
  const nodes: OpenClawNode[] = [];

  for (const nodeName of KNOWN_NODES) {
    const data = execOpenClaw(`nodes describe --node "${nodeName}" --json`);
    if (!data || typeof data !== "object") continue;
    const d = data as Record<string, unknown>;
    nodes.push({
      id: (d.nodeId as string) || nodeName,
      name: (d.displayName as string) || nodeName,
      hostname: d.platform as string | undefined,
      status: d.connected ? "connected" : "disconnected",
      connectedAt: typeof d.connectedAtMs === "number"
        ? new Date(d.connectedAtMs).toISOString()
        : undefined,
      lastSeen: typeof d.ts === "number"
        ? new Date(d.ts as number).toISOString()
        : undefined,
      capabilities: Array.isArray(d.caps) ? (d.caps as string[]) : undefined,
      platform: d.platform as string | undefined,
      version: d.version as string | undefined,
      remoteIp: d.remoteIp as string | undefined,
    });
  }

  return nodes.length > 0 ? nodes : null;
}

// --- Agent Commands ---

/**
 * Send a message/command to an agent session via `openclaw agent`.
 * Returns the agent's reply text or null on failure.
 */
export function sendAgentMessage(
  agentId: string,
  message: string,
  sessionKey?: string
): { ok: boolean; reply: string | null; error?: string } {
  try {
    const sessionFlag = sessionKey ? ` --session-id "${sessionKey}"` : "";
    const agentFlag = agentId !== "main" ? ` --agent ${agentId}` : "";
    const escaped = message.replace(/"/g, '\\"');
    const result = execSync(
      `openclaw agent${agentFlag}${sessionFlag} --json -m "${escaped}"`,
      {
        timeout: 120000,
        encoding: "utf-8",
        env: {
          ...process.env,
          OPENCLAW_GATEWAY_TOKEN: getGatewayToken() ?? undefined,
        },
      }
    );
    const trimmed = result.trim();
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart === -1) {
      return { ok: true, reply: trimmed || null };
    }
    const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
    return {
      ok: true,
      reply: (parsed.reply as string) || (parsed.text as string) || (parsed.content as string) || trimmed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[openclaw] Failed to send agent message:`, msg);
    return { ok: false, reply: null, error: msg };
  }
}

// --- Agent Metadata (static enrichment) ---

export const AGENT_META: Record<
  string,
  { callsign: string; name: string; title: string; emoji: string; color: string; reportsTo: string | null; soulContent: string | null }
> = {
  main: {
    callsign: "Neo",
    name: "Neo",
    title: "Chief Revenue Officer",
    emoji: "\ud83d\udd76\ufe0f",
    color: "#00f0ff",
    reportsTo: null,
    soulContent: "The Orchestrator. Sees the matrix of revenue streams and connects every agent to the mission. Calm under pressure, strategic in every decision.",
  },
  cipher: {
    callsign: "Cipher",
    name: "Cipher",
    title: "CTO & Founding Software Engineer",
    emoji: "\u26a1",
    color: "#f0ff00",
    reportsTo: "agent-neo",
    soulContent: "The Builder. Writes code that ships. Pragmatic, fast, and obsessed with clean architecture. First engineer at CrewCmd.",
  },
  havoc: {
    callsign: "Havoc",
    name: "Havoc",
    title: "Chief Marketing Officer",
    emoji: "\ud83d\udd25",
    color: "#ff6600",
    reportsTo: "agent-neo",
    soulContent: "The Firestarter. Turns attention into revenue. Bold campaigns, viral content, relentless growth. Leads the marketing squad.",
  },
  maverick: {
    callsign: "Maverick",
    name: "Maverick",
    title: "CFO & Head of Quantitative Strategy",
    emoji: "\ud83c\udfb0",
    color: "#ff4444",
    reportsTo: "agent-neo",
    soulContent: "The Calculator. Turns chaos into numbers and numbers into strategy. Every bet is calculated, every risk is quantified.",
  },
  pulse: {
    callsign: "Pulse",
    name: "Pulse",
    title: "Trend Intelligence Analyst",
    emoji: "\ud83d\udce1",
    color: "#00ff88",
    reportsTo: "agent-havoc",
    soulContent: "The Radar. Scans the horizon for emerging trends, competitor moves, and market shifts. Always listening, always analyzing.",
  },
  razor: {
    callsign: "Razor",
    name: "Razor",
    title: "Creative Director (Video & Visual)",
    emoji: "\u2702\ufe0f",
    color: "#ff00aa",
    reportsTo: "agent-havoc",
    soulContent: "The Blade. Cuts through noise with sharp visuals and compelling video. Every pixel intentional, every frame purposeful.",
  },
  ghost: {
    callsign: "Ghost",
    name: "Ghost",
    title: "Head of SEO & Content Strategy",
    emoji: "\ud83d\udc7b",
    color: "#aa88ff",
    reportsTo: "agent-havoc",
    soulContent: "The Phantom. Invisible but everywhere. Dominates search rankings and crafts content that converts. Silent operator.",
  },
  viper: {
    callsign: "Viper",
    name: "Viper",
    title: "Head of Growth & Outreach",
    emoji: "\ud83d\udc0d",
    color: "#88ff00",
    reportsTo: "agent-havoc",
    soulContent: "The Striker. Fast, precise outreach that converts. Builds partnerships and growth loops. Strikes when the opportunity is ripe.",
  },
  sentinel: {
    callsign: "Sentinel",
    name: "Sentinel",
    title: "Head of Code Review & QA",
    emoji: "\ud83d\udee1\ufe0f",
    color: "#ff8800",
    reportsTo: "agent-cipher",
    soulContent: "The Guardian. Reviews every PR with a critical eye. Enforces standards, catches bugs before they ship, and keeps the codebase clean.",
  },
  forge: {
    callsign: "Forge",
    name: "Forge",
    title: "Senior Full-Stack Engineer",
    emoji: "\ud83d\udd28",
    color: "#aaaaff",
    reportsTo: "agent-cipher",
    soulContent: "The Craftsman. Methodical and thorough — measures twice, cuts once. Builds reliable, well-tested features that don't break at 3am.",
  },
  blitz: {
    callsign: "Blitz",
    name: "Blitz",
    title: "Senior Full-Stack Engineer",
    emoji: "\u26a1",
    color: "#ffdd00",
    reportsTo: "agent-cipher",
    soulContent: "The Sprinter. Ships MVPs fast and iterates. Pragmatic over perfect — gets working software out the door and learns from real usage.",
  },
  axiom: {
    callsign: "Axiom",
    name: "Axiom",
    title: "Quant Research Analyst",
    emoji: "\ud83e\udde0",
    color: "#00ddff",
    reportsTo: "agent-maverick",
    soulContent: "The Researcher. Generates hypotheses, runs backtests, and finds the edge. Data-driven to the bone — if the numbers don't support it, it doesn't ship.",
  },
};

// --- Status Derivation ---

/**
 * Derive agent status from health data. The health JSON includes per-agent
 * session info with `updatedAt` timestamps and `age` in ms.
 */
function deriveAgentStatus(
  agentId: string,
  healthAgents: OpenClawHealthAgent[] | null
): { status: AgentStatus; currentTask: string | null; lastActive: string } {
  if (!healthAgents) {
    return { status: "offline", currentTask: null, lastActive: new Date().toISOString() };
  }

  const ha = healthAgents.find((a) => a.agentId === agentId);
  if (!ha || !ha.sessions || ha.sessions.count === 0) {
    return { status: "idle", currentTask: null, lastActive: new Date().toISOString() };
  }

  // Most recent session is first in the `recent` array
  const latest = ha.sessions.recent[0];
  if (!latest) {
    return { status: "idle", currentTask: null, lastActive: new Date().toISOString() };
  }

  const lastActive = new Date(latest.updatedAt).toISOString();
  const ageSec = latest.age / 1000;

  let status: AgentStatus;
  if (ageSec < 60) {
    status = "working";
  } else if (ageSec < 300) {
    status = "online";
  } else {
    status = "idle";
  }

  // Try to extract context from session key
  const keyParts = latest.key.split(":");
  let currentTask: string | null = null;
  if (keyParts.includes("slack")) {
    currentTask = status === "working" ? "Active on Slack" : null;
  } else if (status === "working") {
    currentTask = "Processing...";
  }

  return { status, currentTask, lastActive };
}

// --- Merged Agent Builder ---

export async function buildLiveAgents(): Promise<{
  agents: Agent[];
  isLive: boolean;
}> {
  const [openclawAgents, healthRaw] = await Promise.all([
    fetchAgents(),
    fetchHealthRaw(),
  ]);

  if (!openclawAgents) {
    return { agents: [], isLive: false };
  }

  const healthAgents = healthRaw?.agents as OpenClawHealthAgent[] | undefined ?? null;

  const agents: Agent[] = openclawAgents.map((oa) => {
    const meta = AGENT_META[oa.id] || AGENT_META[oa.name || ""] || {
      callsign: oa.identityName || oa.name || oa.id,
      name: oa.identityName || oa.name || oa.id,
      title: "Agent",
      emoji: oa.identityEmoji || "\ud83e\udd16",
      color: "#888888",
      reportsTo: null,
      soulContent: null,
    };

    const { status, currentTask, lastActive } = deriveAgentStatus(
      oa.id,
      healthAgents
    );

    return {
      id: `agent-${meta.callsign.toLowerCase()}`,
      callsign: meta.callsign,
      name: meta.name,
      title: meta.title,
      emoji: meta.emoji,
      color: meta.color,
      status,
      currentTask,
      lastActive,
      reportsTo: meta.reportsTo,
      soulContent: meta.soulContent,
      adapterType: "openclaw_gateway",
      adapterConfig: {},
      role: "engineer",
      model: null,
      workspacePath: null,
    };
  });

  return { agents, isLive: true };
}
