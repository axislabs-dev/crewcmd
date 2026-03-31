import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime, type AgentConfig } from "@/lib/agent-runtime";
import type { AdapterConfig } from "@/lib/adapters";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** POST /api/agents/[callsign]/restart — Restart an agent process */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const adapterConfig: AdapterConfig = {
    ...(agent.adapterConfig as AdapterConfig),
    model: agent.model ?? undefined,
    workspacePath: agent.workspacePath ?? undefined,
  };

  const config: AgentConfig = {
    agentId: agent.id,
    callsign: agent.callsign,
    adapterType: agent.adapterType,
    adapterConfig,
    model: agent.model ?? undefined,
    workspacePath: agent.workspacePath ?? undefined,
  };

  try {
    runtime.storeAdapterConfig(agent.id, adapterConfig);
    const proc = await runtime.restartAgent(agent.id, config);
    return NextResponse.json({ ok: true, pid: proc.pid, status: proc.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
