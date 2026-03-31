import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkAllAdapters } from "@/lib/adapters";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/** CLI binaries to check for version info */
const CLI_BINARIES: Record<string, string> = {
  claude_local: "claude",
  codex_local: "codex",
  opencode_local: "opencode",
  gemini_local: "gemini",
  pi_local: "pi",
};

/** Check which CLI tools are installed on the system. Returns availability, version, and path. */
async function handleCheck() {
  const availability = await checkAllAdapters();

  // For CLI adapters, also fetch version and path info
  const detailed: Record<string, {
    available: boolean;
    name: string;
    version?: string;
    path?: string;
  }> = {};

  const entries = Object.entries(availability) as [string, { available: boolean; name: string }][];
  await Promise.all(
    entries.map(async ([type, info]) => {
      detailed[type] = { available: info.available, name: info.name };

      const binary = CLI_BINARIES[type];
      if (!binary || !info.available) return;

      // Get path
      try {
        const { stdout } = await execFileAsync("which", [binary]);
        detailed[type].path = stdout.trim();
      } catch {
        // which failed — leave path undefined
      }

      // Get version
      try {
        const { stdout } = await execFileAsync(binary, ["--version"]);
        detailed[type].version = stdout.trim().split("\n")[0];
      } catch {
        // version flag not supported or failed
      }
    })
  );

  return NextResponse.json({ adapters: detailed });
}

/** GET /api/runtime/check — Check adapter availability */
export async function GET() {
  return handleCheck();
}

/** POST /api/runtime/check — Check adapter availability (legacy) */
export async function POST() {
  return handleCheck();
}
