export const BUILTIN_AGENT_VISUAL_STYLE_IDS = [
  "builtin:orbital-reactor",
  "builtin:neural-constellation",
  "builtin:hologram-waveform",
  "builtin:command-core",
] as const;

export type BuiltinAgentVisualStyleId = typeof BUILTIN_AGENT_VISUAL_STYLE_IDS[number];
export type AgentVisualStyleId = BuiltinAgentVisualStyleId | string;
export type AgentVisualAccent = "agent" | "team" | "custom";
export type AgentVisualIntensity = "calm" | "balanced" | "vivid";

export interface AgentVisualSettings {
  styleId?: AgentVisualStyleId;
  accent?: AgentVisualAccent;
  accentColor?: string;
  intensity?: AgentVisualIntensity;
}

export interface AgentVisualStyleOption {
  id: BuiltinAgentVisualStyleId;
  name: string;
  description: string;
}

export const DEFAULT_AGENT_VISUAL_SETTINGS: Required<Pick<AgentVisualSettings, "styleId" | "accent" | "intensity">> = {
  styleId: "builtin:orbital-reactor",
  accent: "agent",
  intensity: "balanced",
};

export const AGENT_VISUAL_STYLE_OPTIONS: AgentVisualStyleOption[] = [
  {
    id: "builtin:orbital-reactor",
    name: "Orbital Reactor",
    description: "Current CrewCMD reactor orb with rings, particles, and a luminous core.",
  },
  {
    id: "builtin:neural-constellation",
    name: "Neural Constellation",
    description: "A living reasoning graph of drifting nodes and luminous links.",
  },
  {
    id: "builtin:hologram-waveform",
    name: "Hologram Waveform",
    description: "Layered translucent audio ribbons with scan highlights.",
  },
  {
    id: "builtin:command-core",
    name: "Command Core",
    description: "Tactical rings, scan arcs, and operational status ticks.",
  },
];

const BUILTIN_STYLE_SET = new Set<string>(BUILTIN_AGENT_VISUAL_STYLE_IDS);
const ACCENT_SET = new Set<AgentVisualAccent>(["agent", "team", "custom"]);
const INTENSITY_SET = new Set<AgentVisualIntensity>(["calm", "balanced", "vivid"]);
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isSupportedAgentVisualStyleId(styleId: string): styleId is BuiltinAgentVisualStyleId {
  return BUILTIN_STYLE_SET.has(styleId);
}

export function normalizeAgentVisualSettings(value: unknown): AgentVisualSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_VISUAL_SETTINGS };
  }

  const record = value as Record<string, unknown>;
  const styleId = typeof record.styleId === "string" && isSupportedAgentVisualStyleId(record.styleId)
    ? record.styleId
    : DEFAULT_AGENT_VISUAL_SETTINGS.styleId;
  const accent = typeof record.accent === "string" && ACCENT_SET.has(record.accent as AgentVisualAccent)
    ? record.accent as AgentVisualAccent
    : DEFAULT_AGENT_VISUAL_SETTINGS.accent;
  const intensity = typeof record.intensity === "string" && INTENSITY_SET.has(record.intensity as AgentVisualIntensity)
    ? record.intensity as AgentVisualIntensity
    : DEFAULT_AGENT_VISUAL_SETTINGS.intensity;
  const accentColor = typeof record.accentColor === "string" && HEX_COLOR_PATTERN.test(record.accentColor)
    ? record.accentColor
    : undefined;

  return {
    styleId,
    accent,
    intensity,
    ...(accentColor ? { accentColor } : {}),
  };
}

export function readTeamVisualSettings(companySettings: unknown): AgentVisualSettings | null {
  if (!companySettings || typeof companySettings !== "object" || Array.isArray(companySettings)) return null;
  const agentStyle = (companySettings as Record<string, unknown>).agentStyle;
  if (!agentStyle || typeof agentStyle !== "object" || Array.isArray(agentStyle)) return null;
  return normalizeAgentVisualSettings((agentStyle as Record<string, unknown>).visual);
}

export function readAgentVisualSettings(runtimeConfig: unknown): AgentVisualSettings | null {
  if (!runtimeConfig || typeof runtimeConfig !== "object" || Array.isArray(runtimeConfig)) return null;
  const visual = (runtimeConfig as Record<string, unknown>).visual;
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) return null;
  return normalizeAgentVisualSettings(visual);
}

export function resolveAgentVisualSettings({
  session,
  agent,
  team,
}: {
  session?: unknown;
  agent?: unknown;
  team?: unknown;
}): AgentVisualSettings {
  return normalizeAgentVisualSettings(session ?? agent ?? team ?? DEFAULT_AGENT_VISUAL_SETTINGS);
}

export function resolveAgentVisualAccentColor({
  settings,
  agentColor,
  teamColor,
}: {
  settings: AgentVisualSettings;
  agentColor?: string | null;
  teamColor?: string | null;
}) {
  const normalized = normalizeAgentVisualSettings(settings);
  if (normalized.accent === "custom" && normalized.accentColor) return normalized.accentColor;
  if (normalized.accent === "team" && teamColor && HEX_COLOR_PATTERN.test(teamColor)) return teamColor;
  if (agentColor && HEX_COLOR_PATTERN.test(agentColor)) return agentColor;
  if (teamColor && HEX_COLOR_PATTERN.test(teamColor)) return teamColor;
  return "#63b7aa";
}
