import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getGatewayClient } from "@/lib/gateway-chat-pool";
import { ensureEventBridge } from "@/lib/init-event-bridge";
import { isOpenClawHeartbeatArtifact } from "@/lib/openclaw-heartbeat-artifacts";

export const dynamic = "force-dynamic";

type GatewayPreviewItem = {
  id?: string;
  messageId?: string;
  createdAt?: string;
  timestamp?: string;
  ts?: string | number;
  role?: string;
  text?: string;
  content?: string;
};

type GatewaySessionPreview = {
  key?: string;
  status?: "ok" | "empty" | "missing" | "error";
  items?: GatewayPreviewItem[];
  messages?: GatewayPreviewItem[];
};

function normalizePreviewItems(preview: GatewaySessionPreview | null) {
  const items = preview?.items ?? preview?.messages ?? [];
  return items
    .map((item) => ({
      id: item.id ?? item.messageId,
      role: item.role === "user" ? "user" : "assistant",
      text: item.text ?? item.content ?? "",
      createdAt: item.createdAt ?? item.timestamp ?? (typeof item.ts === "string" ? item.ts : undefined),
    }))
    .filter((item) => item.text && !isOpenClawHeartbeatArtifact({ role: item.role, content: item.text }));
}

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
    await ensureEventBridge();
    const client = await getGatewayClient();

    const result = await client.rpc<Record<string, unknown>>(
      "sessions.preview",
      { keys: [key], limit: 50, maxChars: 4000 }
    );

    const previews = (result.previews as GatewaySessionPreview[] | undefined) ?? [];
    const preview = previews[0] ?? null;
    const status = preview?.status ?? "missing";
    const items = status === "ok" ? normalizePreviewItems(preview) : [];

    return Response.json({
      key,
      status,
      items,
      preview,
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
