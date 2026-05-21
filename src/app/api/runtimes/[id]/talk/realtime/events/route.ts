import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime, holdClient, releaseClient } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const relaySessionId = new URL(request.url).searchParams.get("relaySessionId")?.trim();
    if (!relaySessionId) return NextResponse.json({ error: "relaySessionId is required" }, { status: 400 });

    const { id } = await params;
    const access = await getAgentAccessContext();
    const readWhere = buildRuntimeReadWhere(access);
    if (!readWhere) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const [runtime] = await withRetry(() =>
      db!
        .select({ id: companyRuntimes.id })
        .from(companyRuntimes)
        .where(and(eq(companyRuntimes.id, id), readWhere))
        .limit(1)
    );
    if (!runtime) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const client = await getGatewayClientForRuntime(runtime.id);
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        holdClient(client);
        const send = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        };
        const onRelay = (payload: unknown) => {
          if (!isRelayPayloadForSession(payload, relaySessionId)) return;
          send("realtime_relay", payload);
        };
        cleanup = () => {
          if (!cleanup) return;
          client.off("talk.event", onRelay);
          client.off("talk.realtime.relay", onRelay);
          request.signal.removeEventListener("abort", cleanup);
          releaseClient(client);
          cleanup = null;
        };

        client.on("talk.event", onRelay);
        client.on("talk.realtime.relay", onRelay);
        request.signal.addEventListener("abort", cleanup, { once: true });
        send("realtime_ready", { relaySessionId });
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isRelayPayloadForSession(payload: unknown, relaySessionId: string) {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return record.relaySessionId === relaySessionId || record.sessionId === relaySessionId;
}
