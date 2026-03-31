import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * Cursor adapter stub.
 * Cursor does not have a reliable CLI interface for programmatic use.
 * This adapter returns an informative error directing users to the Cursor IDE.
 */
export class CursorAdapter implements AdapterExecutor {
  readonly name = "Cursor";

  private static readonly UNSUPPORTED_MESSAGE =
    "Cursor agents require manual configuration in the Cursor IDE. " +
    "Use the Cursor IDE to manage this agent. " +
    "Programmatic task execution is not supported.";

  /** Cursor does not support process spawning */
  async spawn(_config: AdapterConfig): Promise<SpawnResult> {
    throw new Error(CursorAdapter.UNSUPPORTED_MESSAGE);
  }

  /** Cursor does not support programmatic task execution */
  async executeTask(_prompt: string, _config: AdapterConfig): Promise<TaskResult> {
    return { output: CursorAdapter.UNSUPPORTED_MESSAGE, exitCode: 1 };
  }

  /** Cursor CLI is not used programmatically */
  async isAvailable(): Promise<boolean> {
    return false;
  }
}
