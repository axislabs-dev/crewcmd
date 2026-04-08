import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { invokeServiceSkill } from "@/lib/service-skills";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { callsign } = await params;
    const body = await request.json();
    const { skillSlug, action, input } = body;

    if (!skillSlug || typeof skillSlug !== "string") {
      return NextResponse.json({ error: "skillSlug is required" }, { status: 400 });
    }

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const result = await invokeServiceSkill({
      agentCallsign: callsign,
      skillSlug,
      action,
      input: input && typeof input === "object" && !Array.isArray(input) ? input : undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
