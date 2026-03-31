import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** POST /api/agents/[callsign]/stop — Stop a running agent process */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    await runtime.stopAgent(agent.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
