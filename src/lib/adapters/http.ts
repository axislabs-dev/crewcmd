import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * HTTP adapter — sends tasks as POST requests to a configured URL.
 * Not a process-based adapter; communicates via HTTP.
 */
export class HttpAdapter implements AdapterExecutor {
  readonly name = "HTTP";

  /** HTTP adapter does not spawn processes */
  async spawn(_config: AdapterConfig): Promise<SpawnResult> {
    throw new Error("HTTP adapter does not support spawning processes. Use executeTask instead.");
  }

  /** Execute a task by POSTing to the configured URL */
  async executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult> {
    const url = config.url;
    if (!url) {
      return { output: "HTTP adapter requires a 'url' in adapterConfig", exitCode: 1 };
    }

    const timeoutMs = (config.timeoutSec ?? 300) * 1000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.headers ?? {}),
        },
        body: JSON.stringify({ prompt, context: {} }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        return { output: `HTTP ${response.status}: ${text}`, exitCode: 1 };
      }

      const data = await response.json();
      const output = typeof data === "string" ? data : (data.output ?? data.result ?? data.message ?? JSON.stringify(data));
      return { output, exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `HTTP request failed: ${message}`, exitCode: 1 };
    }
  }

  /** HTTP adapter is always available — no CLI dependency */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}
