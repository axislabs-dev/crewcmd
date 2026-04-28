import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

/**
 * OpenClaw Gateway adapter.
 * POSTs to the gateway's chat completions endpoint and parses the response.
 */
const DEFAULT_SYSTEM_PROMPT = [
  "You are running as a CrewCmd worker through the OpenClaw Gateway.",
  "Always produce a final text response after tool use.",
  "If the task succeeds, summarize the concrete result or artifact.",
  "If the task is blocked, state the exact blocker and next action.",
  "Never end silently.",
].join(" ");

const NO_RESPONSE_SENTINELS = [
  "agent couldn't generate a response",
  "agent could not generate a response",
];

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
          messages: [
            { role: "system", content: DEFAULT_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
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
      const normalizedOutput = String(output).toLowerCase();

      if (NO_RESPONSE_SENTINELS.some((sentinel) => normalizedOutput.includes(sentinel))) {
        return {
          output: [
            "OpenClaw Gateway returned no final agent response.",
            "Some tool actions may have already executed, so verify state before retrying.",
            output,
          ].join("\n"),
          exitCode: 1,
        };
      }

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
