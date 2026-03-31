import { BaseCliAdapter } from "./base-cli";
import type { AdapterConfig } from "./types";

/**
 * Adapter for OpenCode CLI.
 * Uses `opencode run` for one-shot task execution.
 */
export class OpenCodeAdapter extends BaseCliAdapter {
  readonly name = "OpenCode";
  protected readonly binary = "opencode";

  protected buildArgs(prompt: string, config: AdapterConfig): string[] {
    const args = ["run"];

    if (config.extraArgs) {
      args.push(...config.extraArgs.split(/\s+/));
    }

    args.push(prompt);
    return args;
  }
}
