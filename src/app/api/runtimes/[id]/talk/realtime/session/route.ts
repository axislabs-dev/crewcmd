import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

const REALTIME_SLOW_SPEECH_SILENCE_MS = 2000;
const REALTIME_SLOW_SPEECH_PREFIX_PADDING_MS = 500;

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
    const client = await getGatewayClientForRuntime(runtime.id);
    const session = await client.realtimeTalkSession({
      sessionKey: readOptionalString(body.sessionKey),
      provider: readOptionalString(body.provider),
      model: readOptionalString(body.model),
      voice: readOptionalString(body.voice),
      agentId: readOptionalString(body.agentId),
      vadThreshold: readOptionalNumber(body.vadThreshold),
      silenceDurationMs: readOptionalNumber(body.silenceDurationMs) ?? REALTIME_SLOW_SPEECH_SILENCE_MS,
      prefixPaddingMs: readOptionalNumber(body.prefixPaddingMs) ?? REALTIME_SLOW_SPEECH_PREFIX_PADDING_MS,
    });

    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
