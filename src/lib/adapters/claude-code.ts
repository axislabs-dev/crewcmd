import { BaseCliAdapter } from "./base-cli";
import type { AdapterConfig } from "./types";

/**
 * Adapter for Claude Code CLI.
 * Uses `claude --print` for one-shot task execution.
 */
export class ClaudeCodeAdapter extends BaseCliAdapter {
  readonly name = "Claude Code";
  protected readonly binary = "claude";

  protected buildArgs(prompt: string, config: AdapterConfig): string[] {
    const args = ["--print", "--output-format", "text"];

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
