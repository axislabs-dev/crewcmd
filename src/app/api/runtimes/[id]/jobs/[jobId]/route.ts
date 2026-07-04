import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const { id, jobId } = await params;
    if (!jobId.trim()) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

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
    if (!provider.getJob) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime job detail` },
        { status: 501 }
      );
    }

    const result = await provider.getJob(runtime, jobId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
