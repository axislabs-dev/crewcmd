import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ callsign: string; skillId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign, skillId } = await params;

    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
    }

    const [row] = await withRetry(() =>
      db!
        .select()
        .from(schema.agentSkills)
        .where(
          and(
            eq(schema.agentSkills.agentId, agent.id),
            eq(schema.agentSkills.skillId, skillId)
          )
        )
    );

    if (!row) {
      return NextResponse.json({ error: "Skill not assigned to this agent" }, { status: 404 });
    }

    const [updated] = await withRetry(() =>
      db!
        .update(schema.agentSkills)
        .set({ enabled })
        .where(eq(schema.agentSkills.id, row.id))
        .returning()
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/agents/[callsign]/skills/[skillId]] PATCH Error:", err);
    return NextResponse.json({ error: "Failed to update skill" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const { callsign, skillId } = await params;

    // Find agent by callsign
    const dbAgents = await withRetry(() => db!.select().from(schema.agents));
    const agent = dbAgents.find((a) => a.callsign.toLowerCase() === callsign.toLowerCase());
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    await withRetry(() =>
      db!.delete(schema.agentSkills).where(
        and(
          eq(schema.agentSkills.agentId, agent.id),
          eq(schema.agentSkills.skillId, skillId)
        )
      )
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/agents/[callsign]/skills/[skillId]] DELETE Error:", err);
    return NextResponse.json({ error: "Failed to detach skill" }, { status: 500 });
  }
}
