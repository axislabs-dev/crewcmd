import { BaseCliAdapter } from "./base-cli";
import type { AdapterConfig } from "./types";

/**
 * Adapter for OpenAI Codex CLI.
 * Uses `codex --quiet` for one-shot task execution.
 */
export class CodexAdapter extends BaseCliAdapter {
  readonly name = "Codex";
  protected readonly binary = "codex";

  protected buildArgs(prompt: string, config: AdapterConfig): string[] {
    const args = ["--quiet"];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.extraArgs) {
      args.push(...config.extraArgs.split(/\s+/));
    }

    args.push(prompt);
    return args;
  }
}
