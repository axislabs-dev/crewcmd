import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolvePrimaryReadableRuntimeForActiveWorkspace } from "@/lib/runtime-cron-sync";
import { getRuntimeProvider } from "@/lib/runtimes/providers";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id.trim()) {
    return NextResponse.json({ error: "job id is required" }, { status: 400 });
  }

  try {
    const runtime = await resolvePrimaryReadableRuntimeForActiveWorkspace();
    if (!runtime) {
      return NextResponse.json({ error: "No connected runtime found" }, { status: 404 });
    }

    const provider = getRuntimeProvider(runtime.runtimeType);
    if (!provider.runJobNow) {
      return NextResponse.json(
        { error: `${provider.displayName} schedule run-now is not supported yet` },
        { status: 501 }
      );
    }

    const result = await provider.runJobNow(runtime, id);
    return NextResponse.json({
      id: result.jobId,
      runtimeId: runtime.id,
      status: result.status,
      runId: result.runId,
      raw: result.raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to run schedule";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
