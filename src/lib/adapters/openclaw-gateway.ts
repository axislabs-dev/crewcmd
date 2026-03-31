import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * OpenClaw Gateway adapter.
 * POSTs to the gateway's chat completions endpoint and parses the response.
 */
export class OpenClawGatewayAdapter implements AdapterExecutor {
  readonly name = "OpenClaw Gateway";

  /** Gateway adapter does not spawn processes */
  async spawn(_config: AdapterConfig): Promise<SpawnResult> {
    throw new Error("OpenClaw Gateway adapter does not support spawning processes. Use executeTask instead.");
  }

  /** Execute a task by POSTing to the gateway chat completions endpoint */
  async executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult> {
    const baseUrl = config.url;
    if (!baseUrl) {
      return { output: "OpenClaw Gateway adapter requires a 'url' in adapterConfig", exitCode: 1 };
    }

    const url = baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
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
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          model: config.model ?? undefined,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        return { output: `Gateway ${response.status}: ${text}`, exitCode: 1 };
      }

      const data = await response.json();
      const output = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return { output, exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Gateway request failed: ${message}`, exitCode: 1 };
    }
  }

  /** Gateway adapter is available if a URL would be configured */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}
