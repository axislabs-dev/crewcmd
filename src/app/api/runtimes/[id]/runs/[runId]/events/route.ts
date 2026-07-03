import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    if (!db) return Response.json({ error: "Database not available" }, { status: 503 });

    const { id, runId } = await params;
    if (!runId.trim()) return Response.json({ error: "runId is required" }, { status: 400 });

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
    if (!provider.getRunEvents) {
      return Response.json(
        { error: `${provider.displayName} does not support runtime run events` },
        { status: 501 }
      );
    }

    const url = new URL(request.url);
    const events = await provider.getRunEvents(runtime, runId, {
      lastEventId: request.headers.get("Last-Event-ID") ?? url.searchParams.get("lastEventId"),
    });

    return new Response(events.stream, {
      status: 200,
      headers: {
        "Content-Type": events.contentType,
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
