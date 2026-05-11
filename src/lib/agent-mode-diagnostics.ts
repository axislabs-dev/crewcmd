export const AGENT_MODE_DIAGNOSTICS_STORAGE_KEY = "crewcmd.agentModeDiagnostics";
export const AGENT_MODE_DIAGNOSTICS_QUERY_PARAM = "agentModeDebug";
export const VOICE_CRASH_BREADCRUMBS_STORAGE_KEY = "crewcmd.voiceCrashBreadcrumbs";
const MAX_VOICE_CRASH_BREADCRUMBS = 160;

export type AgentModeDiagnosticDetail = Record<string, unknown>;

export interface AgentModeDiagnosticEvent {
  scope: string;
  event: string;
  sessionId?: string;
  at: string;
  detail?: AgentModeDiagnosticDetail;
}

export interface VoiceCrashBreadcrumb {
  scope: string;
  event: string;
  sessionId?: string;
  at: string;
  detail?: AgentModeDiagnosticDetail;
}

declare global {
  interface Window {
    __crewcmdAgentModeDiagnostics?: AgentModeDiagnosticEvent[];
    __crewcmdVoiceCrashBreadcrumbs?: VoiceCrashBreadcrumb[];
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

function sanitizeBreadcrumbDetail(detail: AgentModeDiagnosticDetail | undefined) {
  if (!detail) return undefined;
  try {
    return JSON.parse(JSON.stringify(detail)) as AgentModeDiagnosticDetail;
  } catch {
    return { unserializable: true };
  }
}

function readStoredVoiceCrashBreadcrumbs() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VOICE_CRASH_BREADCRUMBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as VoiceCrashBreadcrumb[] : [];
  } catch {
    return [];
  }
}

export function recordVoiceCrashBreadcrumb(event: Omit<VoiceCrashBreadcrumb, "at">) {
  if (typeof window === "undefined") return;

  const entry: VoiceCrashBreadcrumb = {
    ...event,
    at: new Date().toISOString(),
    detail: sanitizeBreadcrumbDetail(event.detail),
  };

  window.__crewcmdVoiceCrashBreadcrumbs ??= readStoredVoiceCrashBreadcrumbs();
  window.__crewcmdVoiceCrashBreadcrumbs.push(entry);
  if (window.__crewcmdVoiceCrashBreadcrumbs.length > MAX_VOICE_CRASH_BREADCRUMBS) {
    window.__crewcmdVoiceCrashBreadcrumbs.splice(
      0,
      window.__crewcmdVoiceCrashBreadcrumbs.length - MAX_VOICE_CRASH_BREADCRUMBS,
    );
  }

  try {
    window.localStorage.setItem(
      VOICE_CRASH_BREADCRUMBS_STORAGE_KEY,
      JSON.stringify(window.__crewcmdVoiceCrashBreadcrumbs),
    );
  } catch {
    // Breadcrumbs are best-effort crash diagnostics.
  }
}

export function snapshotBrowserAgentModeDiagnostics() {
  if (typeof window === "undefined") return [];
  return [...(window.__crewcmdAgentModeDiagnostics ?? [])];
}

export function snapshotVoiceCrashBreadcrumbs() {
  if (typeof window === "undefined") return [];
  return [...(window.__crewcmdVoiceCrashBreadcrumbs ?? readStoredVoiceCrashBreadcrumbs())];
}

export function createAgentModeSessionId(prefix = "agent-mode") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
