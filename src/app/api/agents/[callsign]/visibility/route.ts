import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canUpdateAgent, getAgentAccessContext, normalizeVisibilityForCreation } from "@/lib/agent-access";

export const dynamic = "force-dynamic";
interface RouteParams { params: Promise<{ callsign: string }>; }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { callsign } = await params;
  if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

  try {
    const access = await getAgentAccessContext();
    const { visibility } = await request.json();
    const existing = await withRetry(() => db!.select().from(agents));
    const agent = existing.find((item) => item.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!canUpdateAgent(agent, access)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const nextVisibility = normalizeVisibilityForCreation({ ownerType: agent.ownerType, requestedVisibility: visibility });
    const [updated] = await withRetry(() =>
      db!.update(agents).set({ visibility: nextVisibility }).where(eq(agents.id, agent.id)).returning()
    );

    return NextResponse.json({ success: true, agent: updated, sharingNote: agent.ownerType === "user" ? "Personal agents stay private in v1." : null });
  } catch (error) {
    console.error("[api/agents/:callsign/visibility] PATCH error", error);
    return NextResponse.json({ error: "Failed to update visibility" }, { status: 500 });
  }
}
