import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { OpenCodeAdapter } from "./opencode";
import { GeminiCliAdapter } from "./gemini-cli";
import { PiAdapter } from "./pi";
import { ProcessAdapter } from "./process";
import { HttpAdapter } from "./http";
import { OpenClawGatewayAdapter } from "./openclaw-gateway";
import { CursorAdapter } from "./cursor";
import type { AdapterExecutor } from "./types";

export type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * Registry mapping adapter type strings (from DB) to their executor instances.
 * Keys match the `adapterType` values stored in the agents table.
 */
const adapterRegistry: Record<string, AdapterExecutor> = {
  claude_local: new ClaudeCodeAdapter(),
  codex_local: new CodexAdapter(),
  opencode_local: new OpenCodeAdapter(),
  gemini_local: new GeminiCliAdapter(),
  pi_local: new PiAdapter(),
  process: new ProcessAdapter(),
  http: new HttpAdapter(),
  openclaw_gateway: new OpenClawGatewayAdapter(),
  cursor: new CursorAdapter(),
};

/**
 * Get an adapter executor by its type string.
 * Returns null if the adapter type is not registered.
 */
export function getExecutor(adapterType: string): AdapterExecutor | null {
  return adapterRegistry[adapterType] ?? null;
}

/** @deprecated Use getExecutor instead */
export const getAdapter = getExecutor;

/**
 * Get all registered adapters with their type keys.
 * Used by the runtime check endpoint to report available adapters.
 */
export function getAllAdapters(): Record<string, AdapterExecutor> {
  return { ...adapterRegistry };
}

/**
 * Check availability of all registered adapters.
 * Returns a map of adapter type to availability status.
 */
export async function checkAllAdapters(): Promise<Record<string, { available: boolean; name: string }>> {
  const results: Record<string, { available: boolean; name: string }> = {};
  const entries = Object.entries(adapterRegistry);

  await Promise.all(
    entries.map(async ([type, executor]) => {
      try {
        const available = await executor.isAvailable();
        results[type] = { available, name: executor.name };
      } catch {
        results[type] = { available: false, name: executor.name };
      }
    })
  );

  return results;
}
