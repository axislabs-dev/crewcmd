import { BaseCliAdapter } from "./base-cli";
import type { AdapterConfig } from "./types";

/**
 * Adapter for Google Gemini CLI.
 * Uses `gemini -p` for one-shot (print mode) task execution.
 */
export class GeminiCliAdapter extends BaseCliAdapter {
  readonly name = "Gemini CLI";
  protected readonly binary = "gemini";

  protected buildArgs(prompt: string, config: AdapterConfig): string[] {
    const args = ["-p"];

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
