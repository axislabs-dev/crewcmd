import { NextResponse } from "next/server";
import { getEventBridgeStatus } from "@/lib/gateway-event-bridge";
import { ensureEventBridge } from "@/lib/init-event-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureEventBridge();
    return NextResponse.json(getEventBridgeStatus());
  } catch (error) {
    console.error("[api/openclaw/bridge/status] Error:", error);
    return NextResponse.json(getEventBridgeStatus(), { status: 503 });
  }
}
