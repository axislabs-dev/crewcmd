import type { ChildProcess } from "node:child_process";
import { getExecutor, type AdapterConfig } from "./adapters";

/** Maximum number of output lines to keep per agent */
const MAX_OUTPUT_LINES = 500;

/** Represents a task sent to an agent for execution */
export interface AgentTask {
  /** Unique task identifier */
  id: string;
  /** The prompt/instruction to send to the agent */
  prompt: string;
  /** Current execution status */
  status: "pending" | "running" | "completed" | "failed";
  /** Task output (on completion) */
  result?: string;
  /** Error message (on failure) */
  error?: string;
  /** When the task was created */
  createdAt: Date;
  /** When the task finished (completed or failed) */
  completedAt?: Date;
}

/** Represents a running (or stopped) agent process managed by the runtime */
export interface AgentProcess {
  /** Database agent ID */
  agentId: string;
  /** Agent callsign */
  callsign: string;
  /** Adapter type used */
  adapterType: string;
  /** OS process ID (0 for non-process adapters) */
  pid: number;
  /** Current lifecycle status */
  status: "starting" | "running" | "stopped" | "error" | "crashed";
  /** When the agent was started */
  startedAt: Date;
  /** When the agent was stopped */
  stoppedAt?: Date;
  /** Process exit code */
  exitCode?: number;
  /** Error description */
  error?: string;
  /** Rolling buffer of recent output lines */
  outputBuffer: string[];
  /** Queue of pending tasks */
  taskQueue: AgentTask[];
  /** Currently executing task */
  currentTask?: AgentTask;
}

/** Configuration required to start an agent */
export interface AgentConfig {
  /** Database agent ID */
  agentId: string;
  /** Agent callsign */
  callsign: string;
  /** Adapter type key (e.g. "claude_local") */
  adapterType: string;
  /** Adapter-specific configuration from the DB */
  adapterConfig: AdapterConfig;
  /** Agent's model identifier */
  model?: string;
  /** Agent's workspace directory */
  workspacePath?: string;
}

type OutputCallback = (line: string) => void;

/**
 * Manages the lifecycle of agent processes — spawn, stop, monitor, communicate.
 * Singleton instance persisted via globalThis to survive Next.js hot reloads.
 */
export class AgentRuntime {
  private processes = new Map<string, AgentProcess>();
  private childProcesses = new Map<string, ChildProcess>();
  private outputListeners = new Map<string, Set<OutputCallback>>();

  constructor() {
    // Clean up child processes on server shutdown
    const cleanup = () => {
      for (const [agentId, child] of this.childProcesses) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may already be dead
        }
        const proc = this.processes.get(agentId);
        if (proc) {
          proc.status = "stopped";
          proc.stoppedAt = new Date();
        }
      }
      this.childProcesses.clear();
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
  }

  /**
   * Start an agent process based on its adapter type.
   * For process-based adapters, spawns a long-running child process.
   * For HTTP/gateway adapters, registers the agent as "running" for task dispatch.
   */
  async startAgent(agentId: string, config: AgentConfig): Promise<AgentProcess> {
    // Stop existing process if any
    if (this.processes.has(agentId)) {
      await this.stopAgent(agentId);
    }

    const adapter = getExecutor(config.adapterType);
    if (!adapter) {
      throw new Error(`Unknown adapter type: ${config.adapterType}`);
    }

    const agentProcess: AgentProcess = {
      agentId,
      callsign: config.callsign,
      adapterType: config.adapterType,
      pid: 0,
      status: "starting",
      startedAt: new Date(),
      outputBuffer: [],
      taskQueue: [],
    };

    this.processes.set(agentId, agentProcess);

    // Store adapter config so sendTask can access it later
    const mergedConfig: AdapterConfig = {
      ...config.adapterConfig,
      model: config.model,
      workspacePath: config.workspacePath,
    };
    this.adapterConfigs.set(agentId, mergedConfig);

    // For process-based adapters, try to spawn a long-running process
    const isProcessAdapter = config.adapterType === "process";
    if (isProcessAdapter) {
      try {
        const { pid, process: child } = await adapter.spawn(mergedConfig);
        agentProcess.pid = pid;
        agentProcess.status = "running";

        this.childProcesses.set(agentId, child);
        this.attachProcessListeners(agentId, child);
      } catch (err) {
        agentProcess.status = "error";
        agentProcess.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    } else {
      // Non-process adapters (CLI one-shot, HTTP, gateway) are "running" immediately
      agentProcess.status = "running";
    }

    return agentProcess;
  }

  /** Stop a running agent and kill its child process if any */
  async stopAgent(agentId: string): Promise<void> {
    const proc = this.processes.get(agentId);
    if (!proc) return;

    const child = this.childProcesses.get(agentId);
    if (child) {
      const gracePeriodMs = 10_000;
      child.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
          resolve();
        }, gracePeriodMs);

        child.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      this.childProcesses.delete(agentId);
    }

    proc.status = "stopped";
    proc.stoppedAt = new Date();
  }

  /** Restart an agent — stops then starts with the same config */
  async restartAgent(agentId: string, config: AgentConfig): Promise<AgentProcess> {
    await this.stopAgent(agentId);
    return this.startAgent(agentId, config);
  }

  /**
   * Send a task to an agent for execution.
   * For CLI adapters, this runs a one-shot command.
   * For HTTP/gateway adapters, this sends the request.
   */
  async sendTask(agentId: string, task: AgentTask): Promise<string> {
    const proc = this.processes.get(agentId);
    if (!proc || proc.status !== "running") {
      throw new Error(`Agent ${agentId} is not running`);
    }

    const adapter = getExecutor(proc.adapterType);
    if (!adapter) {
      throw new Error(`Adapter not found: ${proc.adapterType}`);
    }

    // Mark task as running
    task.status = "running";
    proc.currentTask = task;

    this.appendOutput(agentId, `[task:${task.id}] Starting: ${task.prompt.slice(0, 100)}...`);

    try {
      const result = await adapter.executeTask(task.prompt, this.getAdapterConfig(agentId));

      task.status = result.exitCode === 0 ? "completed" : "failed";
      task.result = result.output;
      task.completedAt = new Date();

      if (result.exitCode !== 0) {
        task.error = result.output;
      }

      this.appendOutput(agentId, `[task:${task.id}] ${task.status} (exit: ${result.exitCode})`);

      // Append task output to the buffer
      const outputLines = result.output.split("\n");
      for (const line of outputLines) {
        this.appendOutput(agentId, line);
      }

      proc.currentTask = undefined;
      return result.output;
    } catch (err) {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = new Date();
      proc.currentTask = undefined;

      this.appendOutput(agentId, `[task:${task.id}] Error: ${task.error}`);
      throw err;
    }
  }

  /** Get current status of an agent process */
  getStatus(agentId: string): AgentProcess | null {
    return this.processes.get(agentId) ?? null;
  }

  /** Get all tracked agent processes */
  getAllProcesses(): AgentProcess[] {
    return Array.from(this.processes.values());
  }

  /** Get the output buffer for an agent, optionally limited to the last N lines */
  getOutput(agentId: string, lines?: number): string[] {
    const proc = this.processes.get(agentId);
    if (!proc) return [];
    if (lines && lines > 0) {
      return proc.outputBuffer.slice(-lines);
    }
    return [...proc.outputBuffer];
  }

  /**
   * Subscribe to live output from an agent.
   * Returns an unsubscribe function.
   */
  onOutput(agentId: string, callback: OutputCallback): () => void {
    let listeners = this.outputListeners.get(agentId);
    if (!listeners) {
      listeners = new Set();
      this.outputListeners.set(agentId, listeners);
    }
    listeners.add(callback);

    return () => {
      listeners!.delete(callback);
      if (listeners!.size === 0) {
        this.outputListeners.delete(agentId);
      }
    };
  }

  /** Store the adapter config for an agent so tasks can access it later */
  private adapterConfigs = new Map<string, AdapterConfig>();

  /** Get stored adapter config for an agent */
  private getAdapterConfig(agentId: string): AdapterConfig {
    return this.adapterConfigs.get(agentId) ?? {};
  }

  /** Store adapter config when starting an agent (called from startAgent) */
  storeAdapterConfig(agentId: string, config: AdapterConfig): void {
    this.adapterConfigs.set(agentId, config);
  }

  /** Append a line to an agent's output buffer and notify listeners */
  private appendOutput(agentId: string, line: string): void {
    const proc = this.processes.get(agentId);
    if (!proc) return;

    proc.outputBuffer.push(line);
    if (proc.outputBuffer.length > MAX_OUTPUT_LINES) {
      proc.outputBuffer.splice(0, proc.outputBuffer.length - MAX_OUTPUT_LINES);
    }

    const listeners = this.outputListeners.get(agentId);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(line);
        } catch {
          // Don't let a bad listener crash the runtime
        }
      }
    }
  }

  /** Attach stdout/stderr/close listeners to a child process */
  private attachProcessListeners(agentId: string, child: ChildProcess): void {
    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        this.appendOutput(agentId, line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        this.appendOutput(agentId, `[stderr] ${line}`);
      }
    });

    child.on("close", (code) => {
      const proc = this.processes.get(agentId);
      if (proc && proc.status === "running") {
        proc.status = code === 0 ? "stopped" : "crashed";
        proc.exitCode = code ?? undefined;
        proc.stoppedAt = new Date();
        this.appendOutput(agentId, `[runtime] Process exited with code ${code}`);
      }
      this.childProcesses.delete(agentId);
    });

    child.on("error", (err) => {
      const proc = this.processes.get(agentId);
      if (proc) {
        proc.status = "error";
        proc.error = err.message;
        this.appendOutput(agentId, `[runtime] Process error: ${err.message}`);
      }
      this.childProcesses.delete(agentId);
    });
  }
}

/** Singleton runtime instance, persisted across Next.js hot reloads via globalThis */
const globalRuntime = globalThis as unknown as { __agentRuntime?: AgentRuntime };
export const runtime = globalRuntime.__agentRuntime ??= new AgentRuntime();
