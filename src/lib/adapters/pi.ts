import { BaseCliAdapter } from "./base-cli";
import type { AdapterConfig } from "./types";

/**
 * Adapter for Pi CLI.
 * Uses `pi` for one-shot task execution.
 */
export class PiAdapter extends BaseCliAdapter {
  readonly name = "Pi";
  protected readonly binary = "pi";

  protected buildArgs(prompt: string, config: AdapterConfig): string[] {
    const args: string[] = [];

    if (config.extraArgs) {
      args.push(...config.extraArgs.split(/\s+/));
    }

    args.push(prompt);
    return args;
  }
}
