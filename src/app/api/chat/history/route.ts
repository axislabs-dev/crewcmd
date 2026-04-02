import { NextRequest } from "next/server";
import { getGatewayClient } from "@/lib/gateway-chat-pool";
import { requireAuth } from "@/lib/require-auth";

interface HistoryMessage {
  role: string;
  content: unknown;
}

interface HistoryResponse {
  messages?: HistoryMessage[];
}

/**
 * GET /api/chat/history?sessionKey=sentinel&limit=50
 *
 * Fetches conversation history from the OpenClaw Gateway for a given session.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("sessionKey") || "main";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const client = await getGatewayClient();
    const result = (await client.chatHistory({
      sessionKey,
      limit,
    })) as HistoryResponse;

    // Normalize messages to { role, content } format
    const messages = (result?.messages || []).map((msg: HistoryMessage) => {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<Record<string, unknown>>)
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("");
      } else if (
        msg.content &&
        typeof msg.content === "object" &&
        "text" in (msg.content as Record<string, unknown>)
      ) {
        content = (msg.content as Record<string, string>).text;
      }

      return {
        id: crypto.randomUUID(),
        role: msg.role === "assistant" ? "assistant" : "user",
        content,
      };
    });

    return Response.json({ messages });
  } catch (error) {
    console.error("[api/chat/history] Error:", error);
    return Response.json(
      { error: "Failed to fetch chat history" },
      { status: 500 }
    );
  }
}
