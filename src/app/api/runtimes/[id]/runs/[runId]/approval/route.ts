import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { companyRuntimes } from "@/db/schema";
import { buildRuntimeReadWhere, getAgentAccessContext } from "@/lib/agent-access";
import { getRuntimeProvider } from "@/lib/runtimes/providers";
import type { RuntimeRunApprovalInput } from "@/lib/runtimes/providers/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const body = await request.json().catch(() => null);
    const approval = parseApprovalInput(body);
    if (!approval) {
      return NextResponse.json({ error: "decision is required" }, { status: 400 });
    }

    const { id, runId } = await params;
    if (!runId.trim()) return NextResponse.json({ error: "runId is required" }, { status: 400 });

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
    if (!provider.approveRun) {
      return NextResponse.json(
        { error: `${provider.displayName} does not support runtime run approvals` },
        { status: 501 }
      );
    }

    const run = await provider.approveRun(runtime, runId, approval);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function parseApprovalInput(body: unknown): RuntimeRunApprovalInput | null {
  if (!isRecord(body)) return null;
  const decision = readString(body.decision);
  if (!decision) return null;

  return {
    decision,
    approvalId: readString(body.approvalId) ?? readString(body.approval_id),
    reason: readString(body.reason),
    payload: isRecord(body.payload) ? body.payload : null,
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
