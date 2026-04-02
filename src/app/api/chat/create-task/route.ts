import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { executeToolCall } from "@/lib/chat-tool-executor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, description, priority, assignedAgentId, status } = body;

    if (!title || typeof title !== "string") {
      return Response.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    const resultJson = await executeToolCall({
      tool: "createTask",
      args: {
        title,
        description: description || null,
        priority: priority || "medium",
        assignedAgentId: assignedAgentId || null,
        status: status || "queued",
      },
    });

    const result = JSON.parse(resultJson);

    if (!result.success) {
      return Response.json(
        { error: result.error || "Failed to create task" },
        { status: 500 }
      );
    }

    return Response.json(result);
  } catch (error) {
    console.error("[api/chat/create-task] Error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
