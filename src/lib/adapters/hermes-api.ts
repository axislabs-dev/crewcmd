import { hermesApiUrl } from "@/lib/runtimes/providers";
import type { AdapterConfig, AdapterExecutor, SpawnResult, TaskResult } from "./types";

const DEFAULT_SYSTEM_PROMPT = [
  "You are running as a CrewCmd worker through the Hermes Agent API.",
  "Always produce a final text response after tool use.",
  "If the task succeeds, summarize the concrete result or artifact.",
  "If the task is blocked, state the exact blocker and next action.",
  "Never end silently.",
].join(" ");

export class HermesApiAdapter implements AdapterExecutor {
  readonly name = "Hermes Agent API";

  async spawn(_config: AdapterConfig): Promise<SpawnResult> {
    throw new Error("Hermes API adapter does not support spawning processes. Use executeTask instead.");
  }

  async executeTask(prompt: string, config: AdapterConfig): Promise<TaskResult> {
    if (!config.url) {
      return { output: "Hermes API adapter requires a 'url' in adapterConfig", exitCode: 1 };
    }

    const timeoutMs = (config.timeoutSec ?? 300) * 1000;
    const headers = {
      "Content-Type": "application/json",
      ...authHeaders(config),
      ...(config.headers ?? {}),
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(hermesApiUrl(config.url, "/v1/chat/completions"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model ?? "hermes-agent",
          messages: [
            { role: "system", content: DEFAULT_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        return { output: `Hermes ${response.status}: ${text}`, exitCode: 1 };
      }

      const data = await response.json();
      const output = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.output ?? JSON.stringify(data);
      return { output: String(output), exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Hermes request failed: ${message}`, exitCode: 1 };
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

function authHeaders(config: AdapterConfig): Record<string, string> {
  if (config.headers?.Authorization) return {};
  if (!config.apiKey) return {};
  return { Authorization: `Bearer ${config.apiKey}` };
}
