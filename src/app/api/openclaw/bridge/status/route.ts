import { NextRequest, NextResponse } from "next/server";
import { getEventBridgeStatus } from "@/lib/gateway-event-bridge";
import { ensureEventBridge } from "@/lib/init-event-bridge";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    await ensureEventBridge();
    return NextResponse.json(getEventBridgeStatus());
  } catch (error) {
    console.error("[api/openclaw/bridge/status] Error:", error);
    return NextResponse.json(getEventBridgeStatus(), { status: 503 });
  }
}
