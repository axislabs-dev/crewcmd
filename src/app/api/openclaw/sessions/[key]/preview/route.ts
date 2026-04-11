import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

/**
 * GET /api/openclaw/sessions/[key]/preview
 *
 * Fetch message preview for a specific session from the gateway.
 * Falls back to empty result if gateway preview is not available.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ key: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  let key: string;
  try {
    key = (await props.params).key;
  } catch {
    return Response.json({ error: "Session key required" }, { status: 400 });
  }

  if (!key) {
    return Response.json({ error: "Session key required" }, { status: 400 });
  }

  try {
    const client = await getGatewayClient();

    const result = await client.rpc<Record<string, unknown>>(
      "sessions.preview",
      { keys: [key] }
    );

    const items = (result.items as Array< unknown>) || [];
    const preview = items.length > 0 ? items[0] : null;

    return Response.json({
      key,
      preview: preview || null,
    });
  } catch (error) {
    console.error("[api/openclaw/sessions/preview] Error:", error);
    return Response.json(
      {
        error: "Failed to fetch session preview",
        details: error instanceof Error ? error.message : null,
      },
      { status: 500 }
    );
  }
}
