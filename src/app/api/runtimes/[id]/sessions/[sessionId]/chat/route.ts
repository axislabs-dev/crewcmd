import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const { id, sessionId } = await params;
    if (!sessionId.trim()) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

    const body = await request.json().catch(() => null);
    const input = isRecord(body) ? readString(body.input) : null;
    if (!input) return NextResponse.json({ error: "input is required" }, { status: 400 });

    const access = await getAgentAccessContext();
    const readWhere = buildRuntimeReadWhere(access);
    if (!readWhere) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const [runtime] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(and(eq(companyRuntimes.id, id), readWhere))
        .limit(1)
    );
    if (!runtime) return NextResponse.json({ error: "Runtime not found" }, { status: 404 });

    const provider = getRuntimeProvider(runtime.runtimeType);
    if (!provider.chatSession) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime session chat` },
        { status: 501 }
      );
    }

    const result = await provider.chatSession(runtime, sessionId, {
      input,
      sessionKey: readString(body.sessionKey) ?? readString(body.session_key),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
