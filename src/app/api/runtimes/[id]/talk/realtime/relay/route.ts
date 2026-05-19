import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

type RelayAction = "audio" | "mark" | "toolResult" | "stop";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

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

    const body = await request.json().catch(() => ({}));
    const relaySessionId = readRequiredString(body.relaySessionId, "relaySessionId");
    const action = readRelayAction(body.action);
    const client = await getGatewayClientForRuntime(runtime.id);

    if (action === "audio") {
      const audioBase64 = readRequiredString(body.audioBase64, "audioBase64");
      const result = await client.realtimeRelayAudio({
        relaySessionId,
        audioBase64,
        timestamp: readOptionalNumber(body.timestamp),
        sampleRate: readOptionalNumber(body.sampleRate),
        channels: readOptionalNumber(body.channels),
      });
      return NextResponse.json({ result });
    }

    if (action === "mark") {
      const mark = readRequiredString(body.mark, "mark");
      const result = await client.realtimeRelayMark({ relaySessionId, mark });
      return NextResponse.json({ result });
    }

    if (action === "toolResult") {
      const callId = readRequiredString(body.callId, "callId");
      const result = await client.realtimeRelayToolResult({
        relaySessionId,
        callId,
        output: body.output ?? null,
      });
      return NextResponse.json({ result });
    }

    const result = await client.realtimeRelayStop(relaySessionId);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

class ValidationError extends Error {}

function readRequiredString(value: unknown, name: string) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new ValidationError(`${name} is required`);
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRelayAction(value: unknown): RelayAction {
  if (value === "audio" || value === "mark" || value === "toolResult" || value === "stop") return value;
  throw new ValidationError("action must be audio, mark, toolResult, or stop");
}
