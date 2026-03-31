import { NextRequest, NextResponse } from "next/server";
import { resolveAgent } from "@/lib/resolve-agent";
import { runtime } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

/** GET /api/agents/[callsign]/output — Get the output buffer for an agent */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  const agent = await resolveAgent(callsign);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const linesParam = request.nextUrl.searchParams.get("lines");
  const lines = linesParam ? parseInt(linesParam, 10) : undefined;

  return NextResponse.json({
    lines: runtime.getOutput(agent.id, lines),
  });
}
