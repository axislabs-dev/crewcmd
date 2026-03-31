import { NextRequest } from "next/server";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** GET /api/agents/[callsign]/output/stream — SSE endpoint for live agent output */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return new Response(JSON.stringify({ error: "Agent not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send existing buffer as initial catchup
      const existing = runtime.getOutput(agent.id, 50);
      for (const line of existing) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
      }

      // Subscribe to new output
      const unsubscribe = runtime.onOutput(agent.id, (line: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
        } catch {
          // Stream may be closed
          unsubscribe();
        }
      });

      // Send keepalive pings every 30s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 30_000);

      // Clean up when the client disconnects
      _request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
