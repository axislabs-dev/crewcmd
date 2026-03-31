import { spawn } from "node:child_process";
import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * Generic subprocess adapter.
 * Spawns a user-configured command and pipes the prompt to stdin.
 */
export class ProcessAdapter implements AdapterExecutor {
  readonly name = "Process";

  /** Execute a single task by piping the prompt to the configured command's stdin */
  async executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult> {
    const command = config.command;
    if (!command) {
      return { output: "Process adapter requires a 'command' in adapterConfig", exitCode: 1 };
    }

    const [bin, ...baseArgs] = command.split(/\s+/);
    const args = [...baseArgs];
    if (config.extraArgs) {
      args.push(...config.extraArgs.split(/\s+/));
    }

    const timeoutMs = (config.timeoutSec ?? 300) * 1000;
    const env = { ...process.env, ...(config.envVars ?? {}) };
    const cwd = config.workspacePath ?? process.cwd();

    return new Promise<TaskResult>((resolve) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

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
        resolve({ output: stdout || stderr, exitCode: code ?? 1 });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ output: err.message, exitCode: 1 });
      });

      // Pipe the prompt to stdin
      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }
    });
  }

  /** Spawn a long-running process */
  async spawn(config: AdapterConfig): Promise<SpawnResult> {
    const command = config.command;
    if (!command) {
      throw new Error("Process adapter requires a 'command' in adapterConfig");
    }

    const [bin, ...args] = command.split(/\s+/);
    if (config.extraArgs) {
      args.push(...config.extraArgs.split(/\s+/));
    }

    const env = { ...process.env, ...(config.envVars ?? {}) };
    const cwd = config.workspacePath ?? process.cwd();

    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

    if (!child.pid) {
      throw new Error(`Failed to spawn process '${command}': no PID assigned`);
    }

    return { pid: child.pid, process: child };
  }

  /** Process adapter is always "available" — the user provides the command */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}
