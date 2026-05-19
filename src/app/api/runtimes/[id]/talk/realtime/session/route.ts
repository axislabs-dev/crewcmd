import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getGatewayClientForRuntime } from "@/lib/gateway-chat-pool";

export const dynamic = "force-dynamic";

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
