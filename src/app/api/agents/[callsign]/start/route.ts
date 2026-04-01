import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime, type AgentConfig } from "@/lib/agent-runtime";
import { getExecutor, type AdapterConfig } from "@/lib/adapters";
import { resolveAdapterFromSkills } from "@/lib/resolve-adapter-from-skills";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** POST /api/agents/[callsign]/start — Start an agent process */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Resolve adapter from installed CLI skills, falling back to adapter_type
  const resolution = await resolveAdapterFromSkills(agent.id, agent.adapterType);
  const effectiveAdapterType = resolution.adapterType;

  const adapter = getExecutor(effectiveAdapterType);
  if (!adapter) {
    return NextResponse.json(
      { error: `Unknown adapter type: ${effectiveAdapterType}` },
      { status: 400 }
    );
  }

  // Check adapter availability for CLI-based adapters
  const available = await adapter.isAvailable();
  if (!available) {
    return NextResponse.json(
      { error: `${adapter.name} is not installed or not available on this system` },
      { status: 422 }
    );
  }

  const adapterConfig: AdapterConfig = {
    ...(agent.adapterConfig as AdapterConfig),
    model: agent.model ?? undefined,
    workspacePath: agent.workspacePath ?? undefined,
  };

  const config: AgentConfig = {
    agentId: agent.id,
    callsign: agent.callsign,
    adapterType: effectiveAdapterType,
    adapterConfig,
    model: agent.model ?? undefined,
    workspacePath: agent.workspacePath ?? undefined,
  };

  try {
    runtime.storeAdapterConfig(agent.id, adapterConfig);
    const proc = await runtime.startAgent(agent.id, config);
    return NextResponse.json({
      ok: true,
      pid: proc.pid,
      status: proc.status,
      ...(resolution.fromSkill && { resolvedFromSkill: resolution.skillSlug }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
