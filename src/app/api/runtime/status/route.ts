import { NextRequest, NextResponse } from "next/server";
import { runtime } from "@/lib/agent-runtime";
import { checkAllAdapters } from "@/lib/adapters";
import { requireAuth } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/** GET /api/runtime/status — Overall runtime status with all processes and available adapters */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const processes = runtime.getAllProcesses().map((proc) => ({
    agentId: proc.agentId,
    callsign: proc.callsign,
    adapterType: proc.adapterType,
    pid: proc.pid,
    status: proc.status,
    startedAt: proc.startedAt.toISOString(),
    stoppedAt: proc.stoppedAt?.toISOString() ?? null,
    exitCode: proc.exitCode ?? null,
    error: proc.error ?? null,
    outputLines: proc.outputBuffer.length,
    currentTask: proc.currentTask
      ? { id: proc.currentTask.id, status: proc.currentTask.status }
      : null,
  }));

  const adapters = await checkAllAdapters();

  return NextResponse.json({ processes, availableAdapters: adapters });
}
