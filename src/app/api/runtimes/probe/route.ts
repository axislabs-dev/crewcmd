import { NextResponse } from "next/server";
import { probeGateway } from "@/lib/gateway-client";

/**
 * POST /api/runtimes/probe
 *
 * Probe an OpenClaw gateway: connect, discover agents and models.
 * Does NOT save anything to the database. Used for the preview step.
 *
 * Body: { gatewayUrl: string, authToken: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { gatewayUrl, authToken } = body;

    if (!gatewayUrl || typeof gatewayUrl !== "string") {
      return NextResponse.json(
        { error: "gatewayUrl is required" },
        { status: 400 }
      );
    }

    if (!authToken || typeof authToken !== "string") {
      return NextResponse.json(
        { error: "authToken is required" },
        { status: 400 }
      );
    }

    // Normalize the URL to WebSocket
    let wsUrl = gatewayUrl.trim();
    if (wsUrl.startsWith("http://")) {
      wsUrl = wsUrl.replace("http://", "ws://");
    } else if (wsUrl.startsWith("https://")) {
      wsUrl = wsUrl.replace("https://", "wss://");
    } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = `ws://${wsUrl}`;
    }

    const result = await probeGateway(wsUrl, authToken.trim());

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to connect to gateway" },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
