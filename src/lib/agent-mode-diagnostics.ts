export const AGENT_MODE_DIAGNOSTICS_STORAGE_KEY = "crewcmd.agentModeDiagnostics";
export const AGENT_MODE_DIAGNOSTICS_QUERY_PARAM = "agentModeDebug";

export type AgentModeDiagnosticDetail = Record<string, unknown>;

export interface AgentModeDiagnosticEvent {
  scope: string;
  event: string;
  sessionId?: string;
  at: string;
  detail?: AgentModeDiagnosticDetail;
}

declare global {
  interface Window {
    __crewcmdAgentModeDiagnostics?: AgentModeDiagnosticEvent[];
  }
}

function hasBrowserDiagnosticsEnabled() {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(AGENT_MODE_DIAGNOSTICS_QUERY_PARAM) === "1") return true;
    if (window.localStorage.getItem(AGENT_MODE_DIAGNOSTICS_STORAGE_KEY) === "1") return true;
  } catch {
    return false;
  }

  return false;
}

function isServerDiagnosticsEnabled() {
  return process.env.CREWCMD_AGENT_MODE_DIAGNOSTICS === "1";
}

export function areAgentModeDiagnosticsEnabled() {
  return typeof window === "undefined"
    ? isServerDiagnosticsEnabled()
    : hasBrowserDiagnosticsEnabled();
}

export function publishAgentModeDiagnostic(event: Omit<AgentModeDiagnosticEvent, "at">) {
  if (!areAgentModeDiagnosticsEnabled()) return;

  const entry: AgentModeDiagnosticEvent = {
    ...event,
    at: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    window.__crewcmdAgentModeDiagnostics ??= [];
    window.__crewcmdAgentModeDiagnostics.push(entry);
    if (window.__crewcmdAgentModeDiagnostics.length > 500) {
      window.__crewcmdAgentModeDiagnostics.splice(0, window.__crewcmdAgentModeDiagnostics.length - 500);
    }
  }

  console.info("[agent-mode]", entry);
}

export function snapshotBrowserAgentModeDiagnostics() {
  if (typeof window === "undefined") return [];
  return [...(window.__crewcmdAgentModeDiagnostics ?? [])];
}

export function createAgentModeSessionId(prefix = "agent-mode") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
