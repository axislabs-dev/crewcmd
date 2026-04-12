import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface OpenClawAgentEntry {
  id?: string;
  workspace?: string;
}

interface OpenClawConfigShape {
  agents?: {
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

export function legacyOpenClawWorkspacePath(runtimeRef: string): string {
  return join(homedir(), ".openclaw", `workspace-${runtimeRef}`);
}

