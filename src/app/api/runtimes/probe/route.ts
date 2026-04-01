import { NextResponse } from "next/server";
import { probeGateway } from "@/lib/gateway-client";
import { parseOpenClawConfig } from "@/lib/openclaw-config-parser";

/**
 * POST /api/runtimes/probe
 *
 * Probe an OpenClaw installation to discover agents, models, and config.
 *
 * Supports three modes:
 * 1. "gateway" — Connect via WebSocket with device auth (works local + remote)
 * 2. "local"   — Read ~/.openclaw/openclaw.json directly (same-machine only)
 * 3. "paste"   — Accept raw JSON content (deprecated, kept for compatibility)
 *
 * Gateway mode is the preferred path. It handles:
 * - Ed25519 keypair generation
 * - Challenge-response handshake
 * - Auto-pairing on first connect
 * - Agent/model discovery via RPC
 * - Returns devicePrivateKeyPem for persistent auth
 *
 * Body:
 *   { mode: "gateway", url: string, token: string, deviceKeyPem?: string }
 *   { mode: "local" }
 *   { mode: "paste", config: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = body.mode || "gateway";

    // ── Gateway mode (preferred) ──
    if (mode === "gateway") {
      const url = body.url;
      const token = body.token;

      if (!url || typeof url !== "string") {
        return NextResponse.json(
          { error: "Gateway URL is required" },
          { status: 400 }
        );
      }
      if (!token || typeof token !== "string") {
        return NextResponse.json(
          { error: "Gateway auth token is required" },
          { status: 400 }
        );
      }

      // Normalize the URL to ws:// or wss://
      let wsUrl = url.trim();
      if (wsUrl.startsWith("http://")) wsUrl = wsUrl.replace("http://", "ws://");
      else if (wsUrl.startsWith("https://")) wsUrl = wsUrl.replace("https://", "wss://");
      else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) wsUrl = `ws://${wsUrl}`;

      const existingKeyPem = typeof body.deviceKeyPem === "string" ? body.deviceKeyPem : undefined;

      const result = await probeGateway(wsUrl, token.trim(), existingKeyPem);

      if (!result.ok) {
        // Special case: pairing required — return 200 with status so UI can show approval instructions
        if (result.error === "pairing_required") {
          return NextResponse.json({
            ok: false,
            pairingRequired: true,
            pairingInstructions: result.pairingInstructions,
            devicePrivateKeyPem: result.devicePrivateKeyPem,
          });
        }

        return NextResponse.json(
          { error: result.error || "Failed to connect to gateway" },
          { status: 502 }
        );
      }

      return NextResponse.json(result);
    }

    // ── Local config file mode (same-machine fallback) ──
    if (mode === "local") {
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

    // ── Paste mode (deprecated) ──
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
      { error: `Unknown mode: ${mode}. Use "gateway", "local", or "paste".` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
