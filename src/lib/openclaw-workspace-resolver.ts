import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface OpenClawAgentEntry {
  id?: string;
  workspace?: string;
}

interface OpenClawConfigShape {
  agents?: {
    defaults?: {
      workspace?: string;
    };
    list?: OpenClawAgentEntry[];
  };
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

export async function resolveOpenClawWorkspacePath(params: {
  runtimeRef?: string | null;
  workspacePath?: string | null;
}): Promise<string | null> {
  if (params.workspacePath) {
    return params.workspacePath;
  }

  if (!params.runtimeRef) {
    return null;
  }

  try {
    const raw = await readFile(DEFAULT_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw) as OpenClawConfigShape;
    const match = config.agents?.list?.find((agent) => agent.id === params.runtimeRef);
    return typeof match?.workspace === "string" && match.workspace
      ? match.workspace
      : null;
  } catch {
    return null;
  }
}

export async function resolveOpenClawWorkspaceRoot(params: {
  runtimeRef?: string | null;
  workspacePath?: string | null;
}): Promise<string | null> {
  const config = await readOpenClawConfig();
  const defaultsWorkspace = config?.agents?.defaults?.workspace;
  if (typeof defaultsWorkspace === "string" && defaultsWorkspace) {
    return defaultsWorkspace;
  }

  const resolvedAgentWorkspace =
    params.workspacePath ??
    (params.runtimeRef
      ? config?.agents?.list?.find((agent) => agent.id === params.runtimeRef)?.workspace ?? null
      : null);

  if (typeof resolvedAgentWorkspace === "string" && resolvedAgentWorkspace) {
    const parent = dirname(resolvedAgentWorkspace);
    if (parent.endsWith("/agents")) {
      return dirname(parent);
    }
    return resolvedAgentWorkspace;
  }

  return defaultOpenClawWorkspaceRoot();
}

export function legacyOpenClawWorkspacePath(runtimeRef: string): string {
  return join(homedir(), ".openclaw", `workspace-${runtimeRef}`);
}

export function defaultOpenClawWorkspaceRoot(): string {
  return join(homedir(), ".openclaw", "workspace");
}

async function readOpenClawConfig(): Promise<OpenClawConfigShape | null> {
  try {
    const raw = await readFile(DEFAULT_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as OpenClawConfigShape;
  } catch {
    return null;
  }
}
