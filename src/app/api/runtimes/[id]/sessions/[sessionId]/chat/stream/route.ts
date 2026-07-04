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
    if (!db) return Response.json({ error: "Database not available" }, { status: 503 });

    const { id, sessionId } = await params;
    if (!sessionId.trim()) return Response.json({ error: "sessionId is required" }, { status: 400 });

    const body = await request.json().catch(() => null);
    const input = isRecord(body) ? readString(body.input) : null;
    if (!input) return Response.json({ error: "input is required" }, { status: 400 });

    const access = await getAgentAccessContext();
    const readWhere = buildRuntimeReadWhere(access);
    if (!readWhere) return Response.json({ error: "Runtime not found" }, { status: 404 });

    const [runtime] = await withRetry(() =>
      db!
        .select()
        .from(companyRuntimes)
        .where(and(eq(companyRuntimes.id, id), readWhere))
        .limit(1)
    );
    if (!runtime) return Response.json({ error: "Runtime not found" }, { status: 404 });

    const provider = getRuntimeProvider(runtime.runtimeType);
    if (!provider.streamSessionChat) {
      return Response.json(
        { error: `${provider.displayName} does not support runtime session chat streaming` },
        { status: 501 }
      );
    }

    const result = await provider.streamSessionChat(runtime, sessionId, {
      input,
      sessionKey: readString(body.sessionKey) ?? readString(body.session_key),
    });

    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
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
