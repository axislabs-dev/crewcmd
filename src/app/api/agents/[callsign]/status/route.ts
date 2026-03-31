import { NextRequest, NextResponse } from "next/server";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** GET /api/agents/[callsign]/status — Get runtime status of an agent process */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const proc = runtime.getStatus(agent.id);

  if (!proc) {
    return NextResponse.json({
      status: "not_started",
      pid: null,
      uptime: null,
      currentTask: null,
      outputLines: 0,
    });
  }

  const uptime = proc.status === "running"
    ? Math.floor((Date.now() - proc.startedAt.getTime()) / 1000)
    : null;

  return NextResponse.json({
    status: proc.status,
    pid: proc.pid,
    uptime,
    currentTask: proc.currentTask
      ? { id: proc.currentTask.id, prompt: proc.currentTask.prompt, status: proc.currentTask.status }
      : null,
    outputLines: proc.outputBuffer.length,
    startedAt: proc.startedAt.toISOString(),
    stoppedAt: proc.stoppedAt?.toISOString() ?? null,
    exitCode: proc.exitCode ?? null,
    error: proc.error ?? null,
  });
}
