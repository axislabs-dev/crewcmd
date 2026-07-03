import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";
import type { RuntimeRunCreateInput } from "@/lib/runtimes/providers/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const body = await request.json().catch(() => null);
    const runInput = parseRunInput(body);
    if (!runInput) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }

    const { id } = await params;
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
    if (!provider.createRun) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime run creation` },
        { status: 501 }
      );
    }

    const run = await provider.createRun(runtime, runInput);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function parseRunInput(body: unknown): RuntimeRunCreateInput | null {
  if (!isRecord(body)) return null;
  const input = readString(body.input);
  if (!input) return null;

  return {
    input,
    sessionId: readString(body.sessionId) ?? readString(body.session_id),
    sessionKey: readString(body.sessionKey) ?? readString(body.session_key),
    instructions: readString(body.instructions),
    previousResponseId: readString(body.previousResponseId) ?? readString(body.previous_response_id),
    model: readString(body.model),
    conversationHistory: Array.isArray(body.conversationHistory)
      ? body.conversationHistory
      : Array.isArray(body.conversation_history)
        ? body.conversation_history
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
