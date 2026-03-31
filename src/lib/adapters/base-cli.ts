import { spawn, execFile } from "node:child_process";
import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * Base class for CLI-based adapter executors.
 * Handles process spawning, output capture, timeouts, and availability checks.
 */
export abstract class BaseCliAdapter implements AdapterExecutor {
  abstract readonly name: string;

  /** The CLI binary name (e.g. "claude", "codex") */
  protected abstract readonly binary: string;

  /** Build the argument list for a one-shot task execution */
  protected abstract buildArgs(prompt: string, config: AdapterConfig): string[];

  /** Build the argument list for spawning a long-running process (optional override) */
  protected buildSpawnArgs(config: AdapterConfig): string[] {
    return config.extraArgs ? config.extraArgs.split(/\s+/) : [];
  }

  /** Execute a single task and return the output */
  async executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult> {
    const args = this.buildArgs(prompt, config);
    const timeoutMs = (config.timeoutSec ?? 300) * 1000;
    const env = { ...process.env, ...(config.envVars ?? {}) };
    const cwd = config.workspacePath ?? process.cwd();

    return new Promise<TaskResult>((resolve) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      const child = spawn(this.binary, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, (config.gracePeriodSec ?? 10) * 1000);
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => errChunks.push(chunk));

      child.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errChunks).toString("utf-8");
        resolve({
          output: stdout || stderr,
          exitCode: code ?? 1,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ output: err.message, exitCode: 1 });
      });
    });
  }

  /** Spawn a long-running agent process */
  async spawn(config: AdapterConfig): Promise<SpawnResult> {
    const args = this.buildSpawnArgs(config);
    const env = { ...process.env, ...(config.envVars ?? {}) };
    const cwd = config.workspacePath ?? process.cwd();

    const child = spawn(this.binary, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

    if (!child.pid) {
      throw new Error(`Failed to spawn ${this.binary}: no PID assigned`);
    }

    return { pid: child.pid, process: child };
  }

  /** Check if the CLI binary is installed */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      execFile("which", [this.binary], (err) => {
        resolve(!err);
      });
    });
  }
}
