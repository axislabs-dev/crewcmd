import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

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
    if (!provider.listJobs) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime jobs` },
        { status: 501 }
      );
    }

    const result = await provider.listJobs(runtime);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const body = await request.json().catch(() => null);
    if (!isWritableObject(body)) {
      return NextResponse.json({ error: "job definition is required" }, { status: 400 });
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
    if (!provider.createJob) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime job creation` },
        { status: 501 }
      );
    }

    const result = await provider.createJob(runtime, { body });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isWritableObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}
