import { NextResponse } from "next/server";
import { parseOpenClawConfig } from "@/lib/openclaw-config-parser";

/**
 * POST /api/runtimes/probe
 *
 * Probe an OpenClaw installation: discover agents, models, gateway config.
 *
 * Supports two modes:
 * 1. Local config file: reads ~/.openclaw/openclaw.json directly + workspace files
 * 2. Pasted config: accepts raw JSON content (user copies from their remote machine)
 *
 * Body: { mode: "local" } | { mode: "paste", config: string }
 *
 * The gateway WebSocket protocol requires device identity (crypto keypair signing)
 * to grant operator scopes. Token-only auth connects but with zero scopes.
 * So for discovery, we read the config file directly instead.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = body.mode || "local";

    if (mode === "local") {
      // Read from default path or specified path
      const configPath = typeof body.configPath === "string" ? body.configPath : undefined;
      const result = await parseOpenClawConfig({ path: configPath });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error || "Failed to parse config" },
          { status: 502 }
        );
      }

      return NextResponse.json(result);
    }

    if (mode === "paste") {
      const config = body.config;
      if (!config || typeof config !== "string") {
        return NextResponse.json(
          { error: "config content is required for paste mode" },
          { status: 400 }
        );
      }

      const result = await parseOpenClawConfig({ content: config });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error || "Failed to parse config" },
          { status: 502 }
        );
      }

      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Unknown mode: ${mode}. Use "local" or "paste".` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
