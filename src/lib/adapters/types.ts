import type { ChildProcess } from "node:child_process";

/** Configuration passed to adapter executors from the agent's DB record */
export interface AdapterConfig {
  /** Working directory for the agent process */
  workspacePath?: string;
  /** CLI command override (for process adapter) */
  command?: string;
  /** HTTP/gateway endpoint URL */
  url?: string;
  /** HTTP headers (auth tokens, etc.) */
  headers?: Record<string, string>;
  /** Extra CLI arguments */
  extraArgs?: string;
  /** Environment variables to inject */
  envVars?: Record<string, string>;
  /** Execution timeout in seconds (default: 300) */
  timeoutSec?: number;
  /** Graceful shutdown period in seconds */
  gracePeriodSec?: number;
  /** Extended thinking level */
  thinkingEffort?: string;
  /** Custom prompt template prepended to tasks */
  promptTemplate?: string;
  /** Path to instructions file */
  instructionsFile?: string;
  /** API key (for OpenRouter/HTTP adapters) */
  apiKey?: string;
  /** API base URL override */
  baseUrl?: string;
  /** Model identifier */
  model?: string;
}

/** Result of spawning a long-running agent process */
export interface SpawnResult {
  pid: number;
  process: ChildProcess;
}

/** Result of a one-shot task execution */
export interface TaskResult {
  output: string;
  exitCode: number;
}

/**
 * Interface that all adapter executors must implement.
 * Each adapter knows how to spawn and communicate with a specific agent CLI or API.
 */
export interface AdapterExecutor {
  /** Spawn a long-running agent process (for agents that stay alive) */
  spawn(config: AdapterConfig): Promise<SpawnResult>;

  /** Execute a single task (one-shot) — most adapters use this */
  executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult>;

  /** Check if the CLI tool is installed and available */
  isAvailable(): Promise<boolean>;

  /** Human-readable adapter name */
  readonly name: string;
}
